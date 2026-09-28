import {
  BookingSchema,
  ReceiptSchema,
  WizardDraftSchema,
  WizardPatchSchema,
  type Booking,
  type Provider,
  type Receipt,
  type Schedule,
  type Slot,
  type WizardDraft,
  type WizardFieldValue,
  type WizardPatch,
} from '@bupa/contracts';
import { bookingWizard, type WizardFieldDefinition } from '@bupa/contracts/wizard';
import { canUse, fail, id, now, type BackendContext } from './domain.js';
import { detectSafety } from './safety.js';

const definitions = new Map(bookingWizard.fields.map((field) => [field.id, field]));
const WHAT_TO_BRING =
  'Passport or student ID · Bupa member card (in the app) · When symptoms started · Any medication you take';
const clone = <T>(value: T): T => structuredClone(value);
const blank = () => ({ value: null, source: 'user', confirmed: false }) as const;

function ownedDraft(ctx: BackendContext, draftId: string): WizardDraft {
  const draft = ctx.store.schedule.drafts.find((item) => item.id === draftId);
  if (!draft || ctx.store.draftSessions.get(draftId) !== ctx.session.id) {
    fail(404, 'DRAFT_NOT_FOUND', 'This draft was not found in the active session.');
  }
  return draft;
}

function editableDraft(ctx: BackendContext, draftId: string): WizardDraft {
  const draft = ownedDraft(ctx, draftId);
  if (draft.status !== 'draft') fail(409, 'DRAFT_CLOSED', 'This draft is no longer editable.');
  return draft;
}

function missing(value: WizardFieldValue | undefined) {
  return value === null || value === undefined || (typeof value === 'string' && !value.trim());
}

function validateValue(def: WizardFieldDefinition, value: WizardFieldValue) {
  if (value === null) return;
  if (def.type === 'boolean') {
    if (typeof value !== 'boolean') fail(400, 'INVALID_FIELD', `${def.id} must be a boolean.`);
    return;
  }
  if (typeof value !== 'string' || value.length > 4000) {
    fail(400, 'INVALID_FIELD', `${def.id} must be a string of at most 4000 characters.`);
  }
  if (value === '') return;
  if (def.options && !def.options.some((option) => option.value === value)) {
    fail(400, 'INVALID_FIELD', `${def.id} is not a supported option.`);
  }
  if (def.type === 'postcode' && !/^\d{4}$/.test(value)) {
    fail(400, 'INVALID_FIELD', 'Enter a four-digit Australian postcode.');
  }
}

function validateFields(fields: Record<string, WizardFieldValue>, mode: 'user' | 'conversation') {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
    fail(400, 'INVALID_FIELDS', 'Fields must be an object.');
  }
  for (const [key, value] of Object.entries(fields)) {
    const def = definitions.get(key);
    if (!def || def.type === 'readonly') {
      fail(400, 'INVALID_FIELD', `${key} is not an editable booking field.`);
    }
    if (mode === 'conversation' && !def.sources.includes('conversation')) {
      fail(403, 'FIELD_SOURCE_FORBIDDEN', `${key} cannot be prefilled from a conversation.`);
    }
    validateValue(def, value);
  }
}

/** Cover text is always derived by the server; neither form nor model can set it. */
export function refreshDraftCover(ctx: BackendContext, draft: WizardDraft) {
  const cover = ctx.store.profile.covers.find(
    (item) => item.service === draft.fields.serviceType?.value,
  );
  const values: Record<string, WizardFieldValue> = {
    coverStatus: cover?.status ?? 'needs_confirmation',
    coverOutOfPocket: cover?.outOfPocket
      ? `${cover.outOfPocket.min}-${cover.outOfPocket.max}`
      : null,
    coverSource: cover?.sourceLabel ?? null,
    coverDisclaimer: cover?.disclaimer ?? 'Estimate only. Confirm the benefit with Bupa.',
  };
  for (const [key, value] of Object.entries(values)) {
    if (draft.fields[key]?.value !== value) {
      draft.fields[key] = { value, source: 'cover', confirmed: false };
    }
  }
}

function profileValue(ctx: BackendContext, def: WizardFieldDefinition): WizardFieldValue {
  if (!def.profileField) return null;
  const value = ctx.store.profile.member.fields[def.profileField].value;
  if (def.type !== 'boolean') return value || null;
  if (def.profileField === 'consultPreference') return value === 'video' || value === 'either';
  return value === 'yes' || value === 'true';
}

function validateSafety(fields: Record<string, WizardFieldValue>) {
  for (const key of ['need', 'notes']) {
    const value = fields[key];
    if (typeof value !== 'string') continue;
    const alert = detectSafety(value, /[\u3400-\u9fff]/u.test(value) ? 'zh' : 'en');
    if (alert) fail(400, 'SAFETY_ALERT', alert.message);
  }
}

function providerCompatible(provider: Provider, service: WizardFieldValue | undefined) {
  if (service === 'gp') return provider.service === 'gp' || provider.service === 'telehealth';
  if (service === 'telehealth') {
    return provider.telehealth && (provider.service === 'gp' || provider.service === 'telehealth');
  }
  return provider.service === service;
}

function selection(
  ctx: BackendContext,
  draft: WizardDraft,
  required = false,
): { provider?: Provider; slot?: Slot } {
  const providerId = draft.fields.providerId?.value;
  const slotId = draft.fields.slotId?.value;
  if (missing(providerId)) {
    if (!missing(slotId) || required)
      fail(400, 'MISSING_FIELDS', 'Choose a clinic and a time in step 3.');
    return {};
  }
  const provider = ctx.store.providers.find((item) => item.id === providerId);
  if (!provider || !providerCompatible(provider, draft.fields.serviceType?.value)) {
    fail(400, 'INVALID_PROVIDER', 'The selected provider does not offer this service.');
  }
  if (missing(slotId)) {
    if (required) fail(400, 'MISSING_FIELDS', 'Choose a time in step 3.');
    return { provider };
  }
  const slot = provider.slots.find((item) => item.id === slotId);
  if (!slot) fail(400, 'INVALID_SLOT', 'The selected time does not belong to this provider.');
  const start = Date.parse(slot.startsAt);
  const end = Date.parse(slot.endsAt);
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    end <= start ||
    start <= ctx.store.clock().getTime()
  ) {
    fail(409, 'SLOT_UNAVAILABLE', 'This time is no longer available. Please choose another time.');
  }
  const occupied = ctx.store.schedule.bookings.some(
    (booking) =>
      booking.status === 'confirmed' &&
      booking.id !== draft.rescheduleOf &&
      booking.providerId === provider.id &&
      Date.parse(booking.slot.startsAt) < end &&
      Date.parse(booking.slot.endsAt) > start,
  );
  if (occupied)
    fail(409, 'SLOT_UNAVAILABLE', 'This time has been booked. Please choose another time.');
  return { provider, slot };
}

function validateStep(ctx: BackendContext, draft: WizardDraft, step: number) {
  if (
    step === 1 &&
    draft.fields.serviceType?.value === 'mental_health' &&
    !canUse(ctx, 'mentalHealthNeed')
  ) {
    fail(
      403,
      'CONSENT_REQUIRED',
      'Separate session consent is required before using sensitive mental-health information to arrange an appointment.',
    );
  }
  const absent: string[] = [];
  for (const def of bookingWizard.fields) {
    if (
      def.step !== step ||
      def.hiddenWhen?.in.includes(String(draft.fields[def.hiddenWhen.field]?.value))
    )
      continue;
    const required = def.requiredWhen
      ? def.requiredWhen.in.includes(String(draft.fields[def.requiredWhen.field]?.value))
      : def.required;
    const field = draft.fields[def.id];
    if (
      def.consent &&
      field?.source !== 'user' &&
      !missing(field?.value) &&
      !canUse(ctx, def.consent)
    ) {
      fail(403, 'CONSENT_REQUIRED', `Permission to use ${def.consent} is no longer active.`);
    }
    if (required && missing(draft.fields[def.id]?.value)) absent.push(def.id);
  }
  if (absent.length) fail(400, 'MISSING_FIELDS', `Complete step ${step}: ${absent.join(', ')}.`);
  if (step === 3) selection(ctx, draft, true);
}

function applyFields(
  ctx: BackendContext,
  draft: WizardDraft,
  fields: Record<string, WizardFieldValue>,
  mode: 'user' | 'conversation',
) {
  validateFields(fields, mode);
  validateSafety(fields);
  const nextService = fields.serviceType ?? draft.fields.serviceType?.value;
  if (mode === 'conversation') {
    for (const key of Object.keys(fields)) {
      const def = definitions.get(key)!;
      if (def.consent && !canUse(ctx, def.consent)) {
        fail(403, 'CONSENT_REQUIRED', `Permission is required before using ${def.consent}.`);
      }
    }
    if (
      nextService === 'mental_health' &&
      ('serviceType' in fields || 'need' in fields) &&
      !canUse(ctx, 'mentalHealthNeed')
    ) {
      fail(
        403,
        'CONSENT_REQUIRED',
        'Separate permission is required for sensitive mental-health information.',
      );
    }
  }
  const changed = Object.keys(fields).filter((key) => draft.fields[key]?.value !== fields[key]);
  const serviceChanged = changed.includes('serviceType');
  const providerChanged = changed.includes('providerId');
  if (serviceChanged) {
    draft.fields.providerId = blank();
    draft.fields.slotId = blank();
  } else if (providerChanged) {
    draft.fields.slotId = blank();
  }
  for (const [key, value] of Object.entries(fields)) {
    // Repeating an AI suggestion must not remove a user's existing confirmation.
    if (mode === 'conversation' && draft.fields[key]?.value === value) continue;
    draft.fields[key] = { value, source: mode, confirmed: mode === 'user' };
  }
  if (serviceChanged) refreshDraftCover(ctx, draft);
  // Stale availability must not prevent navigating back to choose a new time.
  // New selections are checked now; advancing and final submission recheck availability.
  if (['serviceType', 'providerId', 'slotId'].some((key) => key in fields)) selection(ctx, draft);
  return changed;
}

function invalidatedProgress(ctx: BackendContext, draft: WizardDraft, changed: string[]) {
  let progress = ctx.store.draftProgress.get(draft.id) ?? 1;
  for (const key of changed) {
    progress = Math.min(progress, definitions.get(key)!.step);
  }
  for (const def of bookingWizard.fields) {
    if (def.step >= progress && draft.fields[def.id]) draft.fields[def.id]!.confirmed = false;
  }
  return progress;
}

function saveDraft(ctx: BackendContext, draft: WizardDraft, progress: number) {
  draft.updatedAt = now(ctx);
  const index = ctx.store.schedule.drafts.findIndex((item) => item.id === draft.id);
  ctx.store.schedule.drafts[index] = WizardDraftSchema.parse(draft);
  ctx.store.draftProgress.set(draft.id, progress);
  return clone(draft);
}

export function createDraft(
  ctx: BackendContext,
  input: { prefill?: Record<string, WizardFieldValue>; rescheduleOf?: string | null } = {},
) {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => !['prefill', 'rescheduleOf'].includes(key))
  ) {
    fail(
      400,
      'INVALID_DRAFT',
      'Only prefill and rescheduleOf may be supplied when creating a draft.',
    );
  }
  const stamp = now(ctx);
  const draft: WizardDraft = {
    id: id('draft'),
    type: 'booking',
    step: 1,
    status: 'draft',
    createdAt: stamp,
    updatedAt: stamp,
    fields: {},
    rescheduleOf: input.rescheduleOf ?? null,
  };
  for (const def of bookingWizard.fields) {
    if (def.profileField && canUse(ctx, def.consent ?? def.profileField)) {
      draft.fields[def.id] = { value: profileValue(ctx, def), source: 'profile', confirmed: false };
    } else {
      draft.fields[def.id] = {
        value: def.type === 'boolean' ? def.id === 'reminder' : null,
        source: 'user',
        confirmed: false,
      };
    }
  }
  draft.fields.serviceType = { value: 'gp', source: 'user', confirmed: false };
  draft.fields.reminderLead = { value: '2h', source: 'user', confirmed: false };
  draft.fields.whatToBring = { value: WHAT_TO_BRING, source: 'cover', confirmed: false };
  if (draft.rescheduleOf) {
    const booking = ctx.store.schedule.bookings.find((item) => item.id === draft.rescheduleOf);
    if (!booking) fail(404, 'BOOKING_NOT_FOUND', 'The appointment to reschedule was not found.');
    if (booking.status !== 'confirmed')
      fail(409, 'BOOKING_CANCELLED', 'A cancelled appointment cannot be rescheduled.');
    applyFields(
      ctx,
      draft,
      {
        serviceType: booking.service,
        need: booking.need,
        providerId: booking.providerId,
        patientName: booking.patientName,
        interpreter: booking.interpreter,
        language: booking.language,
      },
      'user',
    );
  }
  applyFields(ctx, draft, input.prefill ?? {}, 'user');
  refreshDraftCover(ctx, draft);
  // Prefill is never a confirmation that the user has reviewed a step.
  for (const field of Object.values(draft.fields)) field.confirmed = false;
  const result = WizardDraftSchema.parse(draft);
  ctx.store.schedule.drafts.push(result);
  ctx.store.draftSessions.set(draft.id, ctx.session.id);
  ctx.store.draftProgress.set(draft.id, 1);
  return clone(result);
}

export function getDraft(ctx: BackendContext, draftId: string) {
  return clone(ownedDraft(ctx, draftId));
}

export function patchDraft(ctx: BackendContext, draftId: string, patch: WizardPatch) {
  const parsed = WizardPatchSchema.strict().safeParse(patch);
  if (!parsed.success)
    fail(400, 'INVALID_PATCH', 'Only editable fields and a step number may be updated.');
  const current = editableDraft(ctx, draftId);
  const draft = clone(current);
  const changed = applyFields(ctx, draft, parsed.data.fields ?? {}, 'user');
  let progress = invalidatedProgress(ctx, draft, changed);
  if (parsed.data.step !== undefined) {
    const requested = parsed.data.step;
    if (requested > current.step + 1 || requested > progress + 1) {
      fail(400, 'STEP_ORDER', `Review each step in order; return to step ${progress} first.`);
    }
    if (requested > current.step) {
      for (let step = 1; step <= current.step; step++) validateStep(ctx, draft, step);
      for (const def of bookingWizard.fields) {
        if (def.step === current.step && draft.fields[def.id])
          draft.fields[def.id]!.confirmed = true;
      }
      progress = Math.max(progress, requested);
    }
    draft.step = requested;
  } else if (draft.step > progress) {
    // A human edit to a previous step requires that step to be reviewed again.
    draft.step = progress;
  }
  return saveDraft(ctx, draft, progress);
}

/** Model capability: prefill permitted values only, without navigation or submission. */
export function prefillDraft(
  ctx: BackendContext,
  draftId: string,
  fields: Record<string, WizardFieldValue>,
) {
  const draft = clone(editableDraft(ctx, draftId));
  const changed = applyFields(ctx, draft, fields, 'conversation');
  const progress = invalidatedProgress(ctx, draft, changed);
  return { draft: saveDraft(ctx, draft, progress), changed };
}

function actionReceipt(
  ctx: BackendContext,
  booking: Booking,
  action: 'book' | 'reschedule' | 'cancel',
): Receipt {
  return ReceiptSchema.parse({
    id: id('receipt'),
    kind: 'action',
    createdAt: now(ctx),
    summary: `${action === 'cancel' ? 'Cancelled' : action === 'reschedule' ? 'Rescheduled' : 'Booking'}: ${booking.provider.name}`,
    purpose:
      action === 'cancel'
        ? 'Cancel the appointment requested by the user'
        : 'Create the booking confirmed by the user in the wizard',
    benefit:
      action === 'cancel'
        ? 'Appointment cancelled and its reminders disabled'
        : 'Appointment, requested reminders and notes added to the Dashboard',
    excludedUses: [
      'No payment taken',
      'No change to your policy',
      'No information sent to a real clinic',
    ],
    retention: ctx.store.persistent
      ? 'Stored locally with the confirmed demo booking until demo reset'
      : 'In-memory demo record; cleared when the demo resets or the server restarts',
    scope: 'single_action',
    status: 'completed',
    fields: [],
    bookingId: booking.id,
    sensitive: booking.service === 'mental_health',
  });
}

function cancelInternal(ctx: BackendContext, booking: Booking) {
  booking.status = 'cancelled';
  for (const reminder of ctx.store.schedule.reminders) {
    if (reminder.bookingId === booking.id) reminder.enabled = false;
  }
  for (const receipt of ctx.store.receipts) {
    if (
      receipt.kind === 'action' &&
      receipt.bookingId === booking.id &&
      receipt.status === 'completed'
    ) {
      receipt.status = 'cancelled';
    }
  }
}

export function submitDraft(
  ctx: BackendContext,
  draftId: string,
): { booking: Booking; receipt: Receipt } {
  const previous = ctx.store.submissions.get(draftId);
  if (previous) {
    const booking = ctx.store.schedule.bookings.find((item) => item.id === previous.bookingId);
    const receipt = ctx.store.receipts.find((item) => item.id === previous.receiptId);
    if (!booking || !receipt)
      fail(409, 'BOOKING_STATE_INVALID', 'The original booking result is unavailable.');
    return clone({ booking, receipt });
  }
  const draft = ownedDraft(ctx, draftId);
  if (draft.status === 'submitted') {
    const booking = ctx.store.schedule.bookings.find((item) => item.draftId === draft.id);
    const receipt = ctx.store.receipts.find(
      (item) => item.kind === 'action' && item.bookingId === booking?.id,
    );
    if (!booking || !receipt)
      fail(409, 'BOOKING_STATE_INVALID', 'The original booking result is unavailable.');
    return clone({ booking, receipt });
  }
  if (draft.status !== 'draft') fail(409, 'DRAFT_CLOSED', 'This draft is no longer editable.');
  validateSafety(
    Object.fromEntries(Object.entries(draft.fields).map(([key, field]) => [key, field.value])),
  );
  if (draft.step !== 5 || ctx.store.draftProgress.get(draft.id) !== 5) {
    fail(400, 'STEP_ORDER', 'Review all five steps before confirming the booking.');
  }
  for (let step = 1; step <= 5; step++) validateStep(ctx, draft, step);
  const { provider, slot } = selection(ctx, draft, true);
  if (!provider || !slot) fail(400, 'MISSING_FIELDS', 'Choose a clinic and a time.');
  let original: Booking | undefined;
  if (draft.rescheduleOf) {
    original = ctx.store.schedule.bookings.find((item) => item.id === draft.rescheduleOf);
    if (!original || original.status !== 'confirmed') {
      fail(
        409,
        'RESCHEDULE_CONFLICT',
        'The original appointment is no longer available to reschedule.',
      );
    }
  }
  const booking = BookingSchema.parse({
    id: id('booking'),
    draftId: draft.id,
    providerId: provider.id,
    provider,
    slot,
    service: draft.fields.serviceType!.value,
    need: draft.fields.need!.value,
    patientName: draft.fields.patientName!.value,
    interpreter: draft.fields.interpreter?.value === true,
    language:
      typeof draft.fields.language?.value === 'string' ? draft.fields.language.value || null : null,
    outOfPocket: provider.outOfPocket,
    whatToBring: String(draft.fields.whatToBring?.value ?? '')
      .split('·')
      .map((item) => item.trim())
      .filter(Boolean),
    status: 'confirmed',
    createdAt: now(ctx),
    demo: true,
  });
  const receipt = actionReceipt(ctx, booking, original ? 'reschedule' : 'book');
  // Everything above is validated before changing the old booking or occupying the slot.
  if (original) cancelInternal(ctx, original);
  ctx.store.schedule.bookings.push(booking);
  ctx.store.receipts.push(receipt);
  if (draft.fields.reminder?.value === true) {
    const hours = draft.fields.reminderLead?.value === '24h' ? 24 : 2;
    const at = Math.max(ctx.store.clock().getTime(), Date.parse(slot.startsAt) - hours * 3_600_000);
    ctx.store.schedule.reminders.push({
      id: id('reminder'),
      bookingId: booking.id,
      text: `Appointment at ${provider.name}`,
      at: new Date(at).toISOString(),
      enabled: true,
      createdBy: 'ai',
    });
  }
  if (booking.whatToBring.length) {
    ctx.store.schedule.notes.push({
      id: id('note'),
      bookingId: booking.id,
      text: `What to bring: ${booking.whatToBring.join(' · ')}`,
      createdBy: 'ai',
    });
  }
  const notes = draft.fields.notes;
  if (typeof notes?.value === 'string' && notes.value.trim()) {
    ctx.store.schedule.notes.push({
      id: id('note'),
      bookingId: booking.id,
      text: notes.value,
      createdBy: notes.source === 'user' ? 'user' : 'ai',
    });
  }
  draft.status = 'submitted';
  draft.updatedAt = now(ctx);
  for (const field of Object.values(draft.fields)) field.confirmed = true;
  ctx.store.submissions.set(draft.id, {
    bookingId: booking.id,
    receiptId: receipt.id,
    conversationId: draft.conversationId ?? null,
  });
  // Confirmation has its own booking snapshot; retries no longer require raw draft fields.
  draft.fields = {};
  return clone({ booking, receipt });
}

export function abandonDraft(ctx: BackendContext, draftId: string) {
  const draft = ownedDraft(ctx, draftId);
  if (draft.status === 'submitted')
    fail(409, 'DRAFT_CLOSED', 'The draft has already been submitted.');
  if (draft.status !== 'abandoned') {
    draft.status = 'abandoned';
    draft.updatedAt = now(ctx);
  }
}

export function cancelBooking(ctx: BackendContext, bookingId: string): Schedule {
  const booking = ctx.store.schedule.bookings.find((item) => item.id === bookingId);
  if (!booking) fail(404, 'BOOKING_NOT_FOUND', 'The appointment was not found.');
  if (booking.status === 'confirmed') {
    const receipt = actionReceipt(ctx, booking, 'cancel');
    cancelInternal(ctx, booking);
    ctx.store.receipts.push(receipt);
  }
  return clone(ctx.store.schedule);
}
