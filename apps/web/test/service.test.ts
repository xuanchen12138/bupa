import assert from 'node:assert/strict';
import test from 'node:test';
import { DEMO_CONVERSATION_ID } from '@bupa/contracts/fixtures';
import { ApiError } from '../src/lib/errors.ts';
import { createService, pickFirstProvider, runTurn, types } from './helpers.ts';

test('first initialisation seeds one sample conversation, an enabled preset and a ready overview', async () => {
  const { service } = createService();
  const list = await service.conversations();
  assert.equal(list.items.length, 1);
  assert.equal(list.items[0]?.id, DEMO_CONVERSATION_ID);
  assert.equal(list.items[0]?.seeded, true);
  const settings = await service.personalization();
  assert.equal(settings.enabled, true);
  assert.equal(settings.presetByDemo, true);
  const overview = await service.healthOverview();
  assert.equal(overview.status, 'ready');
  assert.equal(overview.dataMode, 'fictional');
  assert.equal(overview.facts.length, 1);
  assert.deepEqual(
    overview.suggestions.map((s) => [s.action, s.state]),
    [
      ['update_status', 'available'],
      ['prepare_gp_booking', 'available'],
    ],
  );
  assert.equal(overview.facts[0]?.sources[0]?.conversationId, DEMO_CONVERSATION_ID);
});

test('reloading the store restores history and does not re-seed after the sample is deleted', async () => {
  const { service, reload } = createService();
  const conversation = await service.createConversation({ requestId: 'r1' });
  await runTurn(service, conversation.id, '急诊和 GP 有什么区别？');
  await service.deleteConversation(DEMO_CONVERSATION_ID);

  const again = reload();
  const list = await again.conversations();
  assert.deepEqual(
    list.items.map((c) => c.id),
    [conversation.id],
    'the deleted sample must not come back',
  );
  const messages = await again.conversationMessages(conversation.id);
  assert.ok(messages.items.some((e) => e.kind === 'assistant'));
  assert.equal(messages.conversation.latestTurn?.status, 'completed');
  assert.equal(messages.conversation.title, '急诊和 GP 有什么区别');
  const overview = await again.healthOverview();
  assert.equal(overview.status, 'empty', 'no arm source left → empty, never a fixture card');
});

test('the same requestId never creates a second conversation', async () => {
  const { service } = createService();
  const a = await service.createConversation({ requestId: 'same' });
  const b = await service.createConversation({ requestId: 'same' });
  assert.equal(a.id, b.id);
  const list = await service.conversations();
  assert.equal(list.items.length, 1, 'blank conversations are not listed');
});

test('a turn persists every displayable event and dedupes the clientMessageId', async () => {
  const { service } = createService();
  const conversation = await service.createConversation({ requestId: 'gp' });
  const events = await runTurn(service, conversation.id, '我这两天喉咙痛、有点低烧，想看医生', {
    clientMessageId: 'cm-1',
    onConsent: 'session',
  });
  assert.equal(events[0]?.payload.type, 'turn_accepted');
  assert.ok(types(events).includes('consent_request'));
  assert.ok(types(events).includes('provider_options'));
  assert.ok(!types(events).includes('wizard_open'), 'no draft until the member picks a clinic');
  assert.equal(events.at(-1)?.payload.type, 'done');
  assert.deepEqual(
    events.map((e) => e.eventIndex),
    events.map((_, i) => i),
    'eventIndex is contiguous',
  );

  const picked = await pickFirstProvider(service, conversation.id, events);
  assert.equal(
    picked.entry.kind === 'providers' && picked.entry.selectedProviderId,
    picked.draft.fields.providerId?.value,
  );
  const messages = await service.conversationMessages(conversation.id);
  const kinds = messages.items.map((e) => e.kind);
  assert.ok(kinds.includes('consent'));
  assert.ok(kinds.includes('providers'));
  assert.ok(kinds.includes('wizard'));
  const consent = messages.items.find((e) => e.kind === 'consent');
  assert.equal(consent?.kind === 'consent' && consent.status, 'granted');
  const tools = messages.items.filter((e) => e.kind === 'tool');
  assert.ok(
    tools.every((t) => t.kind === 'tool' && t.status === 'done'),
    'tool rows update in place',
  );
  assert.equal(messages.conversation.activeDraftId !== null, true);

  const replay = await runTurn(service, conversation.id, 'anything', { clientMessageId: 'cm-1' });
  assert.equal(replay.length, 0, 'a retried clientMessageId adds nothing');
  const after = await service.conversationMessages(conversation.id);
  assert.equal(after.items.length, messages.items.length);
});

test('aborting a running turn marks it interrupted and releases the consent waiter', async () => {
  const { service } = createService();
  const conversation = await service.createConversation({ requestId: 'abort' });
  const controller = new AbortController();
  const run = runTurn(service, conversation.id, '我喉咙痛想看医生', {
    onConsent: null,
    signal: controller.signal,
  });
  // Wait until the script is parked on the consent card, then abort.
  for (let i = 0; i < 100; i += 1) {
    await new Promise((r) => setTimeout(r, 100));
    const { items } = await service.conversationMessages(conversation.id);
    if (items.some((e) => e.kind === 'consent')) break;
  }
  controller.abort();
  await run;
  const messages = await service.conversationMessages(conversation.id);
  assert.equal(messages.conversation.latestTurn?.status, 'interrupted');
  const consent = messages.items.find((e) => e.kind === 'consent');
  assert.equal(consent?.kind === 'consent' && consent.status, 'expired');
  // The conversation is free again.
  const next = await runTurn(service, conversation.id, '谢谢');
  assert.equal(next.at(-1)?.payload.type, 'done');
});

test('a status update in the source conversation changes the fact and the suggestions', async () => {
  const { service } = createService();
  await runTurn(
    service,
    DEMO_CONVERSATION_ID,
    '关于之前提到的手臂受伤，我现在的情况是：好一些了，但还有点疼',
  );
  let overview = await service.healthOverview();
  assert.equal(overview.facts[0]?.state, 'reported_improving');
  assert.equal(overview.suggestions.length, 2, 'improving keeps both suggestions');

  await runTurn(service, DEMO_CONVERSATION_ID, '我的手臂已经完全恢复了');
  overview = await service.healthOverview();
  assert.equal(overview.facts[0]?.state, 'reported_resolved');
  assert.equal(overview.suggestions.length, 0, 'recovered → no more prompting');
});

test('dismiss survives regeneration and a stale revision is rejected', async () => {
  const { service } = createService();
  const overview = await service.healthOverview();
  const target = overview.suggestions.find((s) => s.action === 'update_status')!;
  await assert.rejects(
    service.dismissSuggestion(target.id, {
      expectedSnapshotRevision: overview.snapshotRevision - 1,
    }),
    (error: unknown) => error instanceof ApiError && error.code === 'STALE_SUGGESTION',
  );
  const after = await service.dismissSuggestion(target.id, {
    expectedSnapshotRevision: overview.snapshotRevision,
  });
  assert.equal(after.suggestions.find((s) => s.id === target.id)?.state, 'dismissed');
  // New source revision (a new message) regenerates facts but keeps the dismissal.
  const other = await service.createConversation({ requestId: 'x' });
  await runTurn(service, other.id, '谢谢');
  const regenerated = await service.healthOverview();
  assert.equal(regenerated.suggestions.find((s) => s.id === target.id)?.state, 'dismissed');
  assert.equal(regenerated.facts.length, 1, 'the fact itself is still visible');
});

test('preparing a GP booking is idempotent, prefills from the source and links the booking', async () => {
  const { service } = createService();
  const overview = await service.healthOverview();
  const suggestion = overview.suggestions.find((s) => s.action === 'prepare_gp_booking')!;
  const first = await service.startSuggestion(suggestion.id, {
    requestId: 'click-1',
    expectedSnapshotRevision: overview.snapshotRevision,
  });
  const again = await service.startSuggestion(suggestion.id, {
    requestId: 'click-1',
    expectedSnapshotRevision: overview.snapshotRevision,
  });
  assert.equal(again.conversationId, first.conversationId, 'double click → same follow-up');
  assert.equal(again.clientMessageId, first.clientMessageId);
  let list = await service.conversations();
  assert.equal(list.items.length, 1, 'the follow-up is not listed until it has a message');

  const events = await runTurn(service, first.conversationId, first.initialMessage.zh, {
    clientMessageId: first.clientMessageId,
    originSuggestionId: first.originSuggestionId,
    onConsent: 'session',
  });
  const { draft } = await pickFirstProvider(service, first.conversationId, events);
  assert.equal(draft.conversationId, first.conversationId);
  assert.match(String(draft.fields.need?.value), /手臂受伤/);
  assert.equal(draft.fields.need?.source, 'conversation');

  // The suggestion message itself is not new evidence.
  const messages = await service.conversationMessages(first.conversationId);
  const user = messages.items.find((e) => e.kind === 'user');
  assert.equal(user?.kind === 'user' && user.origin, 'suggestion_action');
  assert.equal(user?.kind === 'user' && user.sourceRefs[0]?.conversationId, DEMO_CONVERSATION_ID);
  let mid = await service.healthOverview();
  assert.equal(mid.facts.length, 1);
  assert.equal(mid.suggestions.find((s) => s.id === suggestion.id)?.state, 'in_progress');

  // Same message retried: nothing duplicated, no second draft.
  await runTurn(service, first.conversationId, first.initialMessage.zh, {
    clientMessageId: first.clientMessageId,
    originSuggestionId: first.originSuggestionId,
  });
  const schedule = await service.schedule();
  assert.equal(schedule.drafts.length, 1);
  assert.equal(schedule.bookings.length, 0, 'nothing is booked until the member submits');

  // Submit from the wizard: the booking lands in the follow-up conversation, not "whatever is open".
  for (const step of [2, 3, 4, 5]) await service.patchDraft(draft.id, { step });
  const result = await service.submitDraft(draft.id);
  assert.equal(result.conversationId, first.conversationId);
  const withBooking = await service.conversationMessages(first.conversationId);
  assert.ok(
    withBooking.items.some((e) => e.kind === 'booking' && e.bookingId === result.booking.id),
  );
  mid = await service.healthOverview();
  const booked = mid.suggestions.find((s) => s.id === suggestion.id);
  assert.equal(booked?.state, 'booked');
  assert.equal(booked?.bookingId, result.booking.id);
  assert.equal(mid.facts[0]?.state, 'unknown', 'a booking is not evidence of recovery');
  assert.equal(
    mid.suggestions.some((s) => s.action === 'update_status'),
    false,
    'no “how is it” prompt once a visit is arranged',
  );

  // Cancel → suggestion becomes cancelled and can be prepared again in the same conversation.
  await service.cancelBooking(result.booking.id);
  mid = await service.healthOverview();
  assert.equal(mid.suggestions.find((s) => s.id === suggestion.id)?.state, 'cancelled');
  const restart = await service.startSuggestion(suggestion.id, {
    requestId: 'click-2',
    expectedSnapshotRevision: mid.snapshotRevision,
  });
  assert.equal(restart.conversationId, first.conversationId);
  assert.notEqual(restart.clientMessageId, first.clientMessageId);
  list = await service.conversations();
  assert.equal(list.items.length, 2);
});

test('deleting the source conversation removes the overview, redacts derived prompts and keeps bookings', async () => {
  const { service } = createService();
  const overview = await service.healthOverview();
  const suggestion = overview.suggestions.find((s) => s.action === 'prepare_gp_booking')!;
  const start = await service.startSuggestion(suggestion.id, {
    requestId: 'c',
    expectedSnapshotRevision: overview.snapshotRevision,
  });
  const events = await runTurn(service, start.conversationId, start.initialMessage.zh, {
    clientMessageId: start.clientMessageId,
    originSuggestionId: start.originSuggestionId,
    onConsent: 'session',
  });
  const { draft } = await pickFirstProvider(service, start.conversationId, events);
  for (const step of [2, 3, 4, 5]) await service.patchDraft(draft.id, { step });
  const { booking } = await service.submitDraft(draft.id);

  const deleted = await service.deleteConversation(DEMO_CONVERSATION_ID);
  assert.ok(deleted.sourceRevision > overview.sourceRevision);
  const after = await service.healthOverview();
  assert.equal(after.status, 'empty');
  assert.equal(after.facts.length, 0);
  const followUp = await service.conversationMessages(start.conversationId);
  const prompt = followUp.items.find((e) => e.kind === 'user');
  assert.equal(prompt?.kind === 'user' && prompt.text, '', 'derived prompt is redacted');
  const reply = followUp.items.find((e) => e.kind === 'assistant');
  assert.equal(reply?.kind === 'assistant' && reply.text, '', 'derived replies are redacted too');
  const schedule = await service.schedule();
  assert.equal(schedule.bookings.find((b) => b.id === booking.id)?.status, 'confirmed');
  await assert.rejects(
    service.conversationMessages(DEMO_CONVERSATION_ID),
    (e: unknown) => e instanceof ApiError && e.code === 'CONVERSATION_NOT_FOUND',
  );
});

test('deleting a conversation with an unsubmitted draft drops that draft only', async () => {
  const { service } = createService();
  const conversation = await service.createConversation({ requestId: 'd' });
  const events = await runTurn(service, conversation.id, '我喉咙痛想看医生', { onConsent: 'deny' });
  await pickFirstProvider(service, conversation.id, events);
  const manual = await service.createDraft();
  let schedule = await service.schedule();
  assert.equal(schedule.drafts.length, 2);
  await service.deleteConversation(conversation.id);
  schedule = await service.schedule();
  assert.deepEqual(
    schedule.drafts.map((d) => d.id),
    [manual.id],
  );
});

test('deleting the source clears prefill derived from it in a follow-up draft', async () => {
  const { service } = createService();
  const overview = await service.healthOverview();
  const suggestion = overview.suggestions.find((s) => s.action === 'prepare_gp_booking')!;
  const start = await service.startSuggestion(suggestion.id, {
    requestId: 'p',
    expectedSnapshotRevision: overview.snapshotRevision,
  });
  const offered = await runTurn(service, start.conversationId, start.initialMessage.zh, {
    clientMessageId: start.clientMessageId,
    originSuggestionId: start.originSuggestionId,
    onConsent: 'deny',
  });
  await pickFirstProvider(service, start.conversationId, offered);
  let schedule = await service.schedule();
  assert.match(String(schedule.drafts[0]?.fields.need?.value), /手臂/);
  await service.deleteConversation(DEMO_CONVERSATION_ID);
  schedule = await service.schedule();
  assert.equal(schedule.drafts.length, 1, 'the follow-up draft itself stays');
  assert.equal(schedule.drafts[0]?.fields.need?.value, null, 'but the derived need is cleared');
});

test('switching personalisation off clears derived data and keeps chats; on again regenerates', async () => {
  const { service } = createService();
  await service.setPersonalization({ enabled: false });
  let overview = await service.healthOverview();
  assert.equal(overview.status, 'disabled');
  assert.equal(overview.facts.length, 0);
  const receipts = await service.receipts();
  assert.equal(receipts.find((r) => r.fields.includes('healthHistory'))?.status, 'revoked');
  const list = await service.conversations();
  assert.equal(list.items.length, 1, 'chats stay readable');

  await service.setPersonalization({ enabled: true });
  overview = await service.healthOverview();
  assert.equal(overview.status, 'ready');
  const settings = await service.personalization();
  assert.equal(settings.presetByDemo, false, 'an explicit choice is no longer a demo preset');
  assert.equal(
    (await service.receipts()).filter(
      (r) => r.fields.includes('healthHistory') && r.status === 'active',
    ).length,
    1,
  );
});

test('an idle session expires on reload: session grants, drafts and pending consents go, always stays', async () => {
  const { service, reload, advance } = createService();
  const conversation = await service.createConversation({ requestId: 's' });
  const events = await runTurn(service, conversation.id, '我喉咙痛想看医生', {
    onConsent: 'session',
  });
  await pickFirstProvider(service, conversation.id, events);
  let profile = await service.profile();
  assert.equal(profile.member.fields.preferredTime.permission, 'session');
  assert.equal(
    profile.member.fields.postcode.permission,
    'always',
    'membership data needs no grant',
  );
  await service.setPermission({ field: 'preferredLanguage', permission: 'always' });

  advance(31 * 60_000);
  const again = reload();
  profile = await again.profile();
  assert.equal(profile.member.fields.preferredTime.permission, 'off');
  assert.equal(profile.member.fields.preferredLanguage.permission, 'always');
  const schedule = await again.schedule();
  assert.equal(schedule.drafts.length, 0);
  const receipts = await again.receipts();
  assert.equal(receipts.find((r) => r.fields.includes('preferredTime'))?.status, 'revoked');
  const messages = await again.conversationMessages(conversation.id);
  const wizard = messages.items.find((e) => e.kind === 'wizard');
  assert.ok(wizard, 'the history still shows that a booking was prepared');
});

test('a failed write is reported and can be retried without losing state', async () => {
  const { service, store } = createService();
  await service.ready();
  store.failNextSave = new Error('QuotaExceededError');
  await service.createNote({ bookingId: null, text: 'remember the certificate' });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(service.status.state, 'error');
  await service.retryPersist();
  assert.equal(service.status.state, 'ready');
  const saved = await store.load();
  assert.ok(saved?.data.schedule.notes.some((n) => n.text === 'remember the certificate'));
});

test('reset re-seeds the sample and clears everything else', async () => {
  const { service } = createService();
  await service.deleteConversation(DEMO_CONVERSATION_ID);
  const other = await service.createConversation({ requestId: 'o' });
  await runTurn(service, other.id, '谢谢');
  await service.reset({ locale: 'en' });
  const list = await service.conversations();
  assert.deepEqual(
    list.items.map((c) => c.id),
    [DEMO_CONVERSATION_ID],
  );
  assert.equal(list.items[0]?.title, 'Arm injury');
  assert.equal((await service.healthOverview()).status, 'ready');
});

test('sharing preferences for 90 days personalises the ranking until the grant runs out', async () => {
  const { service, reload, advance } = createService();
  const conversation = await service.createConversation({ requestId: 'p90' });
  const events = await runTurn(service, conversation.id, '我感冒了，想看医生', {
    onConsent: 'days90',
  });
  const consent = events.find((e) => e.payload.type === 'consent_request');
  assert.ok(consent && consent.payload.type === 'consent_request');
  assert.deepEqual(consent.payload.request.allowedScopes, ['session', 'days90', 'always']);
  assert.ok(consent.payload.request.fields.includes('preferredTime'));
  assert.ok(!consent.payload.request.fields.includes('postcode'), 'Bupa already has the postcode');

  let profile = await service.profile();
  assert.equal(profile.member.fields.preferredTime.permission, 'days90');
  assert.ok(profile.member.fields.preferredTime.expiresAt);
  const receipts = await service.receipts();
  assert.equal(receipts.find((r) => r.fields.includes('preferredTime'))?.scope, 'days90');

  // Ranking used the shared preferences: a morning slot first, trip within 30 minutes.
  const search = await service.findProviders({
    service: 'gp',
    postcode: '3053',
    language: null,
    telehealthOnly: false,
  });
  assert.ok(search.personalisedBy?.includes('preferredTime'));
  assert.ok(search.personalisedBy?.includes('travelDuration'));
  const first = search.providers[0]!;
  assert.ok(
    new Date(first.slots[0]!.startsAt).getHours() < 12,
    'preferred morning slot comes first',
  );

  // The cards explain each match; picking one prefills the draft from the same ranking.
  const offer = events.find((e) => e.payload.type === 'provider_options');
  assert.ok(offer && offer.payload.type === 'provider_options');
  const topMatch = offer.payload.options.matches[0]!;
  assert.ok(topMatch.points.length >= 3, 'time, travel and language explained');
  assert.ok(
    topMatch.points.every((p) => p.ok),
    'the top pick satisfies every shared preference',
  );
  const { draft } = await pickFirstProvider(service, conversation.id, events);
  assert.equal(draft.fields.postcode?.source, 'profile');
  assert.equal(draft.fields.language?.source, 'profile');
  assert.equal(draft.fields.providerId?.value, offer.payload.options.providers[0]!.id);
  // Picking again the same clinic reuses the draft; nothing is booked.
  const again = await pickFirstProvider(service, conversation.id, events);
  assert.equal(again.draft.id, draft.id);
  assert.equal((await service.schedule()).bookings.length, 0);

  advance(91 * 86_400_000);
  const later = reload();
  profile = await later.profile();
  assert.equal(profile.member.fields.preferredTime.permission, 'off', 'expired after 90 days');
  const after = await later.findProviders({
    service: 'gp',
    postcode: '3053',
    language: null,
    telehealthOnly: false,
  });
  assert.deepEqual(after.personalisedBy ?? [], []);
});

test('declining the preferences still produces distance-ranked options and a draft', async () => {
  const { service } = createService();
  const conversation = await service.createConversation({ requestId: 'deny' });
  const events = await runTurn(service, conversation.id, 'I feel sick', { onConsent: 'deny' });
  assert.ok(types(events).includes('provider_options'));
  const offer = events.find((e) => e.payload.type === 'provider_options');
  assert.ok(offer && offer.payload.type === 'provider_options');
  assert.deepEqual(offer.payload.options.personalisedBy, []);
  const profile = await service.profile();
  assert.equal(profile.member.fields.preferredTime.permission, 'off');
  const messages = await service.conversationMessages(conversation.id);
  const consent = messages.items.find((e) => e.kind === 'consent');
  assert.equal(consent?.kind === 'consent' && consent.status, 'denied');
});
