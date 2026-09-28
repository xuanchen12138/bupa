import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BookingSchema,
  ReceiptSchema,
  ScheduleSchema,
  WizardDraftSchema,
  type WizardDraft,
  type WizardFieldValue,
  type WizardPatch,
} from '@bupa/contracts';
import {
  abandonDraft,
  cancelBooking,
  createDraft,
  getDraft,
  patchDraft,
  prefillDraft,
  submitDraft,
} from '../src/booking.js';
import { DomainError, type BackendContext } from '../src/domain.js';
import { createDemoStore, type SessionState } from '../src/store.js';

function context(): BackendContext {
  const store = createDemoStore(() => new Date('2026-09-28T00:00:00.000Z'));
  const session: SessionState = {
    id: 'session-booking-test',
    status: 'idle',
    grants: new Set(),
    denied: new Set(),
    createdAt: store.clock().getTime(),
    expiresAt: store.clock().getTime() + 3_600_000,
    activeDraftId: null,
    activeChat: null,
  };
  store.sessions.set(session.id, session);
  return { store, session };
}

function errorCode(code: string) {
  return (error: unknown) => error instanceof DomainError && error.code === code;
}

function readyDraft(
  ctx: BackendContext,
  input: Parameters<typeof createDraft>[1] = {},
  slotIndex = 0,
): WizardDraft {
  let draft = createDraft(ctx, {
    prefill: { serviceType: 'gp', need: 'A routine consultation' },
    ...input,
  });
  draft = patchDraft(ctx, draft.id, { step: 2 });
  draft = patchDraft(ctx, draft.id, { step: 3 });
  const provider = ctx.store.providers.find((item) => item.id === 'p-carlton-family')!;
  draft = patchDraft(ctx, draft.id, {
    fields: { providerId: provider.id, slotId: provider.slots[slotIndex]!.id },
    step: 4,
  });
  return patchDraft(ctx, draft.id, { step: 5 });
}

test('drafts use allowed Profile fields only and expose only schema-compatible values', () => {
  const ctx = context();
  const draft = createDraft(ctx);
  assert.equal(WizardDraftSchema.safeParse(draft).success, true);
  assert.equal(draft.fields.patientName?.value, 'Lin Zhao');
  assert.equal(draft.fields.patientName?.source, 'profile');
  assert.equal(draft.fields.postcode?.value, null);
  assert.equal(draft.fields.language?.value, null);
  assert.equal(draft.fields.interpreter?.value, false);
  assert.equal(draft.fields.coverStatus?.source, 'cover');
  draft.fields.patientName!.value = 'Mutated client copy';
  assert.equal(getDraft(ctx, draft.id).fields.patientName?.value, 'Lin Zhao');
});

test('manual create and patch apply the safety stop before persisting changes', () => {
  const ctx = context();
  assert.throws(
    () => createDraft(ctx, { prefill: { need: 'I have chest pain' } }),
    errorCode('SAFETY_ALERT'),
  );
  assert.equal(ctx.store.schedule.drafts.length, 0);
  assert.equal(ctx.store.draftSessions.size, 0);
  const draft = createDraft(ctx, { prefill: { need: 'Sore throat, no chest pain' } });
  assert.throws(
    () => patchDraft(ctx, draft.id, { fields: { notes: '我现在胸痛', postcode: '3053' } }),
    errorCode('SAFETY_ALERT'),
  );
  assert.deepEqual(getDraft(ctx, draft.id), draft);
  assert.throws(
    () => prefillDraft(ctx, draft.id, { need: 'I cannot breathe' }),
    errorCode('SAFETY_ALERT'),
  );
  assert.deepEqual(getDraft(ctx, draft.id), draft);
});

test('submit rechecks safety for a draft populated before the current stop rule', () => {
  const ctx = context();
  const draft = readyDraft(ctx);
  ctx.store.schedule.drafts.find((item) => item.id === draft.id)!.fields.need!.value =
    'I have chest pain';
  assert.throws(() => submitDraft(ctx, draft.id), errorCode('SAFETY_ALERT'));
  assert.equal(ctx.store.schedule.bookings.length, 0);
  assert.equal(ctx.store.receipts.length, 0);
});

test('permission cleanup may remove optional fields without breaking later step confirmation', () => {
  const ctx = context();
  let draft = createDraft(ctx, { prefill: { need: 'Routine consultation' } });
  const stored = ctx.store.schedule.drafts.find((item) => item.id === draft.id)!;
  delete stored.fields.acceptTelehealth;
  delete stored.fields.postcode;
  delete stored.fields.language;
  delete stored.fields.interpreter;
  draft = patchDraft(ctx, draft.id, { step: 2 });
  draft = patchDraft(ctx, draft.id, { step: 3 });
  const provider = ctx.store.providers[0]!;
  draft = patchDraft(ctx, draft.id, {
    fields: { providerId: provider.id, slotId: provider.slots[0]!.id },
    step: 4,
  });
  draft = patchDraft(ctx, draft.id, { step: 5 });
  assert.equal(submitDraft(ctx, draft.id).booking.status, 'confirmed');
});

test('draft ownership, abandoned state and submitted state are enforced', () => {
  const ctx = context();
  const draft = createDraft(ctx);
  const stranger = { ...ctx, session: { ...ctx.session, id: 'stranger' } };
  assert.throws(() => getDraft(stranger, draft.id), errorCode('DRAFT_NOT_FOUND'));
  assert.throws(
    () => patchDraft(stranger, draft.id, { fields: { need: 'changed' } }),
    errorCode('DRAFT_NOT_FOUND'),
  );
  abandonDraft(ctx, draft.id);
  abandonDraft(ctx, draft.id);
  assert.equal(getDraft(ctx, draft.id).status, 'abandoned');
  assert.throws(() => submitDraft(ctx, draft.id), errorCode('DRAFT_CLOSED'));
  assert.throws(
    () => patchDraft(ctx, draft.id, { fields: { need: 'changed' } }),
    errorCode('DRAFT_CLOSED'),
  );
});

test('unknown, cover, forged metadata and invalid primitive edits fail without changing the draft', () => {
  const ctx = context();
  const draft = createDraft(ctx);
  for (const fields of [
    { invented: 'x' },
    { coverStatus: 'included' },
    { coverOutOfPocket: '0-0' },
    { interpreter: 'yes' },
    { serviceType: 'emergency' },
    { postcode: 'not-a-postcode' },
    { need: { value: 'x', source: 'cover', confirmed: true } },
  ]) {
    assert.throws(() =>
      patchDraft(ctx, draft.id, { fields: fields as unknown as Record<string, WizardFieldValue> }),
    );
    assert.deepEqual(getDraft(ctx, draft.id), draft);
  }
  assert.throws(
    () => patchDraft(ctx, draft.id, { status: 'submitted' } as unknown as WizardPatch),
    errorCode('INVALID_PATCH'),
  );
  assert.throws(
    () => createDraft(ctx, { sources: { need: 'cover' } } as never),
    errorCode('INVALID_DRAFT'),
  );
});

test('required fields, one-step navigation and server progression guard final submission', () => {
  const ctx = context();
  const draft = createDraft(ctx);
  assert.throws(() => patchDraft(ctx, draft.id, { step: 2 }), errorCode('MISSING_FIELDS'));
  assert.throws(() => patchDraft(ctx, draft.id, { step: 5 }), errorCode('STEP_ORDER'));
  assert.throws(() => submitDraft(ctx, draft.id), errorCode('STEP_ORDER'));
  const full = readyDraft(ctx);
  ctx.store.draftProgress.set(full.id, 3);
  assert.throws(() => submitDraft(ctx, full.id), errorCode('STEP_ORDER'));
  assert.equal(ctx.store.schedule.bookings.length, 0);
});

test('manual entry remains available after refusing Profile reuse', () => {
  const ctx = context();
  ctx.store.profile.member.fields.name.permission = 'off';
  ctx.store.profile.member.fields.memberNumber.permission = 'off';
  ctx.store.profile.member.fields.phone.permission = 'off';
  const draft = readyDraft(ctx, {
    prefill: {
      serviceType: 'gp',
      need: 'Manual booking',
      patientName: 'Manual Lin',
      memberNumber: 'DEMO-MANUAL',
      phone: 'Mock phone',
      postcode: '3000',
    },
  });
  assert.equal(draft.fields.patientName?.source, 'user');
  assert.equal(submitDraft(ctx, draft.id).booking.patientName, 'Manual Lin');
});

test('model prefills honor field sources and permissions without navigating or submitting', () => {
  const ctx = context();
  const draft = createDraft(ctx);
  assert.throws(
    () => prefillDraft(ctx, draft.id, { patientName: 'Model name' }),
    errorCode('FIELD_SOURCE_FORBIDDEN'),
  );
  assert.throws(
    () => prefillDraft(ctx, draft.id, { postcode: '3053' }),
    errorCode('CONSENT_REQUIRED'),
  );
  assert.throws(
    () => prefillDraft(ctx, draft.id, { serviceType: 'mental_health', need: 'Sensitive concern' }),
    errorCode('CONSENT_REQUIRED'),
  );
  assert.throws(() => prefillDraft(ctx, draft.id, { step: 5 }), errorCode('INVALID_FIELD'));
  ctx.session.grants.add('postcode');
  const result = prefillDraft(ctx, draft.id, { postcode: '3053', need: 'Routine consultation' });
  assert.deepEqual(result.changed, ['postcode', 'need']);
  assert.equal(result.draft.step, 1);
  assert.equal(result.draft.fields.postcode?.source, 'conversation');
  assert.equal(result.draft.fields.need?.confirmed, false);
  assert.equal(ctx.store.schedule.bookings.length, 0);
});

test('late model prefills invalidate previous review and cannot advance the wizard', () => {
  const ctx = context();
  const draft = readyDraft(ctx);
  const updated = prefillDraft(ctx, draft.id, { need: 'A corrected concern' }).draft;
  assert.equal(updated.step, 5);
  assert.equal(ctx.store.draftProgress.get(draft.id), 1);
  assert.throws(() => submitDraft(ctx, draft.id), errorCode('STEP_ORDER'));
  patchDraft(ctx, draft.id, { step: 1 });
  for (const step of [2, 3, 4, 5]) patchDraft(ctx, draft.id, { step });
  assert.equal(submitDraft(ctx, draft.id).booking.need, 'A corrected concern');
});

test('sensitive conversation permission is rechecked when a previously populated draft is used', () => {
  const ctx = context();
  const draft = createDraft(ctx);
  ctx.session.grants.add('mentalHealthNeed');
  prefillDraft(ctx, draft.id, { serviceType: 'mental_health', need: 'Talk about stress' });
  ctx.session.grants.delete('mentalHealthNeed');
  assert.throws(() => patchDraft(ctx, draft.id, { step: 2 }), errorCode('CONSENT_REQUIRED'));
  // Manual entry is allowed, but arranging sensitive care still requires separate consent.
  patchDraft(ctx, draft.id, {
    fields: { serviceType: 'mental_health', need: 'Manually entered concern' },
  });
  assert.throws(() => patchDraft(ctx, draft.id, { step: 2 }), errorCode('CONSENT_REQUIRED'));
  ctx.session.grants.add('mentalHealthNeed');
  patchDraft(ctx, draft.id, { step: 2 });
  assert.equal(getDraft(ctx, draft.id).step, 2);
});

test('manual mental-health bookings cannot bypass sensitive consent with known provider and slot IDs', () => {
  const ctx = context();
  const provider = ctx.store.providers.find((item) => item.id === 'p-blua-mind')!;
  const draft = createDraft(ctx, {
    prefill: {
      serviceType: 'mental_health',
      need: 'Manually entered support request',
      providerId: provider.id,
      slotId: provider.slots[0]!.id,
    },
  });
  assert.equal(draft.fields.need?.source, 'user');
  assert.throws(() => patchDraft(ctx, draft.id, { step: 2 }), errorCode('CONSENT_REQUIRED'));
  ctx.session.grants.add('mentalHealthNeed');
  for (const step of [2, 3, 4, 5]) patchDraft(ctx, draft.id, { step });
  ctx.session.grants.delete('mentalHealthNeed');
  assert.throws(() => submitDraft(ctx, draft.id), errorCode('CONSENT_REQUIRED'));
  assert.equal(ctx.store.schedule.bookings.length, 0);
  ctx.session.grants.add('mentalHealthNeed');
  assert.equal(submitDraft(ctx, draft.id).booking.service, 'mental_health');
});

test('provider, service and slot changes invalidate downstream selections atomically', () => {
  const ctx = context();
  const draft = readyDraft(ctx);
  const second = ctx.store.providers.find((provider) => provider.id === 'p-bupa-health-cbd')!;
  const changed = patchDraft(ctx, draft.id, { fields: { providerId: second.id } });
  assert.equal(changed.step, 3);
  assert.equal(changed.fields.slotId?.value, null);
  assert.throws(
    () => patchDraft(ctx, draft.id, { fields: { slotId: 'fake-slot' } }),
    errorCode('INVALID_SLOT'),
  );
  assert.deepEqual(getDraft(ctx, draft.id), changed);
  const mental = patchDraft(ctx, draft.id, { fields: { serviceType: 'mental_health' } });
  assert.equal(mental.fields.providerId?.value, null);
  assert.equal(mental.fields.slotId?.value, null);
  assert.equal(mental.fields.coverStatus?.value, 'partial');
  assert.equal(mental.step, 1);
  assert.throws(
    () => patchDraft(ctx, draft.id, { fields: { providerId: second.id } }),
    errorCode('INVALID_PROVIDER'),
  );
});

test('successful submit creates a contract-valid booking, receipt, reminder and notes exactly once', () => {
  const ctx = context();
  const draft = readyDraft(ctx);
  const first = submitDraft(ctx, draft.id);
  assert.equal(BookingSchema.safeParse(first.booking).success, true);
  assert.equal(ReceiptSchema.safeParse(first.receipt).success, true);
  assert.equal(ScheduleSchema.safeParse(ctx.store.schedule).success, true);
  assert.equal(first.booking.demo, true);
  assert.equal(first.receipt.scope, 'single_action');
  assert.deepEqual(submitDraft(ctx, draft.id), first);
  assert.equal(ctx.store.schedule.bookings.length, 1);
  assert.equal(ctx.store.schedule.reminders.length, 1);
  assert.equal(ctx.store.schedule.notes.length, 1);
  assert.equal(ctx.store.receipts.length, 1);
  assert.throws(
    () => patchDraft(ctx, draft.id, { fields: { need: 'Changed' } }),
    errorCode('DRAFT_CLOSED'),
  );
});

test('two drafts cannot book the same or overlapping provider slot', () => {
  const ctx = context();
  const first = readyDraft(ctx);
  const second = readyDraft(ctx);
  submitDraft(ctx, first.id);
  assert.throws(() => submitDraft(ctx, second.id), errorCode('SLOT_UNAVAILABLE'));
  assert.equal(getDraft(ctx, second.id).status, 'draft');
  assert.equal(ctx.store.schedule.bookings.length, 1);
  const provider = ctx.store.providers.find((item) => item.id === 'p-carlton-family')!;
  provider.slots.push({ ...provider.slots[0]!, id: 'same-time-different-id' });
  assert.throws(
    () => patchDraft(ctx, second.id, { fields: { slotId: 'same-time-different-id' } }),
    errorCode('SLOT_UNAVAILABLE'),
  );
});

test('slots removed or elapsed after review cannot be submitted', () => {
  const ctx = context();
  const draft = readyDraft(ctx);
  const provider = ctx.store.providers.find((item) => item.id === 'p-carlton-family')!;
  const slot = provider.slots.shift()!;
  assert.throws(() => submitDraft(ctx, draft.id), errorCode('INVALID_SLOT'));
  assert.equal(patchDraft(ctx, draft.id, { step: 3 }).step, 3);
  patchDraft(ctx, draft.id, { fields: { slotId: provider.slots[0]!.id }, step: 4 });
  patchDraft(ctx, draft.id, { step: 5 });
  provider.slots.unshift(slot);
  ctx.store.clock = () => new Date(provider.slots[1]!.startsAt);
  assert.throws(() => submitDraft(ctx, draft.id), errorCode('SLOT_UNAVAILABLE'));
  assert.equal(ctx.store.schedule.bookings.length, 0);
});

test('reschedule preserves the old booking until a valid new booking succeeds', () => {
  const ctx = context();
  const original = submitDraft(ctx, readyDraft(ctx).id).booking;
  const draft = readyDraft(ctx, { rescheduleOf: original.id }, 1);
  assert.equal(ctx.store.schedule.bookings[0]?.status, 'confirmed');
  const provider = ctx.store.providers.find((item) => item.id === original.providerId)!;
  const slot = provider.slots.splice(1, 1)[0]!;
  assert.throws(() => submitDraft(ctx, draft.id), errorCode('INVALID_SLOT'));
  assert.equal(ctx.store.schedule.bookings[0]?.status, 'confirmed');
  assert.equal(ctx.store.schedule.reminders[0]?.enabled, true);
  provider.slots.splice(1, 0, slot);
  const replacement = submitDraft(ctx, draft.id);
  assert.equal(replacement.booking.status, 'confirmed');
  assert.equal(replacement.receipt.summary.startsWith('Rescheduled:'), true);
  assert.equal(ctx.store.schedule.bookings[0]?.status, 'cancelled');
  assert.equal(ctx.store.schedule.reminders[0]?.enabled, false);
  assert.equal(ctx.store.receipts[0]?.status, 'cancelled');
  assert.equal(ctx.store.schedule.reminders[1]?.enabled, true);
});

test('cancel is idempotent, releases a slot, and rejects stale reschedules', () => {
  const ctx = context();
  const original = submitDraft(ctx, readyDraft(ctx).id).booking;
  const reschedule = readyDraft(ctx, { rescheduleOf: original.id }, 1);
  cancelBooking(ctx, original.id);
  assert.equal(ctx.store.schedule.reminders[0]?.enabled, false);
  assert.equal(ctx.store.receipts.length, 2);
  cancelBooking(ctx, original.id);
  assert.equal(ctx.store.receipts.length, 2);
  assert.throws(() => submitDraft(ctx, reschedule.id), errorCode('RESCHEDULE_CONFLICT'));
  assert.throws(
    () => createDraft(ctx, { rescheduleOf: original.id }),
    errorCode('BOOKING_CANCELLED'),
  );
  assert.equal(submitDraft(ctx, readyDraft(ctx).id).booking.status, 'confirmed');
});

test('revoked Profile permission is rechecked at submit even if a stored draft remains populated', () => {
  const ctx = context();
  const draft = readyDraft(ctx);
  ctx.store.profile.member.fields.name.permission = 'off';
  assert.throws(() => submitDraft(ctx, draft.id), errorCode('CONSENT_REQUIRED'));
  const edited = patchDraft(ctx, draft.id, { fields: { patientName: 'Manually entered' } });
  assert.equal(edited.step, 4);
  patchDraft(ctx, draft.id, { step: 5 });
  assert.equal(submitDraft(ctx, draft.id).booking.patientName, 'Manually entered');
});
