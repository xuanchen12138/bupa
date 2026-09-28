import {
  NoteSchema,
  ProfilePatchSchema,
  ProfileResponseSchema,
  ReminderSchema,
  ScheduleSchema,
  type ProfilePatch,
} from '@bupa/contracts';
import { fail, id, type BackendContext } from './domain.js';
import { invalidateField } from './permissions.js';

export function profileForSession(ctx: BackendContext) {
  const profile = structuredClone(ctx.store.profile);
  for (const [key, field] of Object.entries(profile.member.fields)) {
    if (field.permission === 'session') {
      const allowed = ctx.session.grants.has(key);
      field.permission = allowed ? 'session' : 'off';
      field.sessionId = allowed ? ctx.session.id : null;
    }
  }
  return ProfileResponseSchema.parse(profile);
}
export function patchProfile(ctx: BackendContext, input: ProfilePatch) {
  const patch = ProfilePatchSchema.parse(input);
  const candidate = structuredClone(ctx.store.profile);
  for (const [key, value] of Object.entries(patch.fields)) {
    if (value.length > 2000)
      fail(400, 'INVALID_PROFILE', 'Profile values must not exceed 2000 characters.');
    if (key === 'postcode' && value && !/^\d{4}$/.test(value))
      fail(400, 'INVALID_POSTCODE', 'Enter a four-digit postcode.');
    if (key === 'preferredLanguage' && !['', 'en', 'zh-CN', 'other'].includes(value))
      fail(400, 'INVALID_LANGUAGE', 'Choose en, zh-CN or other.');
    if (
      key === 'needCategory' &&
      !['', 'gp', 'dental', 'mental_health', 'telehealth'].includes(value)
    )
      fail(
        400,
        'INVALID_CATEGORY',
        'Only a service category may be stored here, not symptom or diagnosis text.',
      );
    if (key === 'needCategory' && value === 'mental_health')
      fail(
        400,
        'SENSITIVE_CATEGORY',
        'Mental health category is session-only and cannot be saved to Profile.',
      );
    if (key in candidate.member.fields)
      candidate.member.fields[key as keyof typeof candidate.member.fields].value = value;
  }
  ctx.store.profile = ProfileResponseSchema.parse(candidate);
  for (const key of Object.keys(patch.fields)) invalidateField(ctx, key);
  return profileForSession(ctx);
}
export function scheduleForSession(ctx: BackendContext) {
  return ScheduleSchema.parse({
    ...ctx.store.schedule,
    drafts: ctx.store.schedule.drafts.filter(
      (draft) =>
        draft.status === 'draft' && ctx.store.draftSessions.get(draft.id) === ctx.session.id,
    ),
  });
}
function requireBooking(ctx: BackendContext, bookingId: string | null) {
  if (
    bookingId &&
    !ctx.store.schedule.bookings.some(
      (booking) => booking.id === bookingId && booking.status === 'confirmed',
    )
  )
    fail(404, 'NOT_FOUND', 'Active booking not found.');
}
export function createReminder(
  ctx: BackendContext,
  input: { bookingId: string | null; text: string; at: string },
) {
  requireBooking(ctx, input.bookingId);
  if (new Date(input.at).getTime() <= ctx.store.clock().getTime())
    fail(400, 'PAST_REMINDER', 'Reminder time must be in the future.');
  ctx.store.schedule.reminders.push(
    ReminderSchema.parse({ ...input, id: id('reminder'), enabled: true, createdBy: 'user' }),
  );
  return scheduleForSession(ctx);
}
export function toggleReminder(ctx: BackendContext, reminderId: string, enabled: boolean) {
  const reminder = ctx.store.schedule.reminders.find((entry) => entry.id === reminderId);
  if (!reminder) fail(404, 'NOT_FOUND', 'Reminder not found.');
  if (enabled) {
    requireBooking(ctx, reminder.bookingId);
    if (new Date(reminder.at).getTime() <= ctx.store.clock().getTime())
      fail(400, 'PAST_REMINDER', 'Reminder time has passed.');
  }
  reminder.enabled = enabled;
  return scheduleForSession(ctx);
}
export function createNote(ctx: BackendContext, input: { bookingId: string | null; text: string }) {
  requireBooking(ctx, input.bookingId);
  ctx.store.schedule.notes.push(NoteSchema.parse({ ...input, id: id('note'), createdBy: 'user' }));
  return scheduleForSession(ctx);
}
export function dismissCard(ctx: BackendContext, cardId: string) {
  const card = ctx.store.schedule.cards.find((entry) => entry.id === cardId);
  if (!card) fail(404, 'NOT_FOUND', 'Card not found.');
  card.dismissed = true;
  return scheduleForSession(ctx);
}
