import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ConversationSchema,
  ConversationStreamEventSchema,
  ConversationMessagesResponseSchema,
  ConversationListResponseSchema,
  HealthOverviewResponseSchema,
  StartSuggestionResponseSchema,
  WizardDraftSchema,
  type Conversation,
  type ConversationTurnRequest,
} from '@bupa/contracts';
import { createApp } from '../src/app.js';
import { Repository } from '../src/repository.js';
import { PersonalizationService } from '../src/personalization.js';
import { createDemoStore } from '../src/store.js';
import { createSession, closeSession } from '../src/sessions.js';
import { setPermission, requestConsent, resolveConsent } from '../src/permissions.js';
import { createDraft, patchDraft, submitDraft, cancelBooking } from '../src/booking.js';
import { detectSafety } from '../src/safety.js';
import type { EvidenceMessage, Extraction, LanguageModel } from '../src/models.js';
const clock = () => new Date('2030-06-03T00:00:00.000Z');
function mockModel(overrides: Partial<LanguageModel> = {}): LanguageModel {
  return {
    mode: 'model',
    name: 'controlled-test-double',
    async plan() {
      return { intent: 'fallback', service: 'gp' };
    },
    async reply() {
      return { en: 'A controlled reply', zh: '可控回复' };
    },
    async extract() {
      return { facts: [] };
    },
    ...overrides,
  };
}
function fact(messages: EvidenceMessage[], state = 'unknown'): Extraction {
  const first = messages[0]!;
  return {
    facts: [
      {
        anchorMessageId: first.id,
        anchorQuote: first.text,
        subject: 'self',
        asserted: true,
        title: { en: 'Unsupported diagnosis must never be published', zh: '不得发布的额外诊断' },
        state: state as 'unknown',
        evidence: messages.map((message) => ({ messageId: message.id, quote: message.text })),
        occurredAt: { value: null, precision: 'unknown' },
        occurrenceEvidence: null,
      },
    ],
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function setup(model: LanguageModel | null = mockModel(), repo = new Repository()) {
  const store = repo.loadOwner('demo-lin', clock);
  const ctx = { store, session: createSession(store) };
  const health = new PersonalizationService(repo, model);
  return { repo, store, ctx, health };
}
function source(
  s: ReturnType<typeof setup>,
  text = 'My arm was injured.',
  conversation?: Conversation,
) {
  const conv =
    conversation ??
    s.repo.createConversation(s.store.ownerId, crypto.randomUUID(), clock().toISOString());
  const request: ConversationTurnRequest = {
    clientMessageId: crypto.randomUUID(),
    message: text,
    uiLocale: 'en',
    openDraftId: null,
    originSuggestionId: null,
  };
  const started = s.repo.beginTurn(
    s.store.ownerId,
    conv.id,
    s.ctx.session.id,
    request,
    clock().toISOString(),
  );
  s.repo.finishTurn(s.store.ownerId, started.turn.id, 'completed');
  return {
    conv,
    entry: started.user,
    ref: {
      conversationId: conv.id,
      messageId: started.user.id,
      reportedAt: started.user.createdAt,
    },
  };
}
async function generate(s: ReturnType<typeof setup>) {
  s.health.setEnabled(s.ctx, true);
  s.health.refresh(s.store);
  await s.health.idle(s.store.ownerId);
  return s.repo.overview(s.store.ownerId);
}
function browser(app: ReturnType<typeof createApp>, owner?: string) {
  let cookie = '';
  return async (path: string, method = 'GET', body?: unknown) => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Cookie: cookie };
    if (owner) headers['X-Test-Owner'] = owner;
    const response = await app.request(path, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    cookie = response.headers.get('set-cookie')?.split(';')[0] ?? cookie;
    return response;
  };
}
async function events(response: Response) {
  assert.equal(response.status, 200);
  return (await response.text()).split('\n\n').flatMap((frame) => {
    const data = frame.split('\n').find((line) => line.startsWith('data: '));
    return data ? [ConversationStreamEventSchema.parse(JSON.parse(data.slice(6)))] : [];
  });
}
const turnBody = (id: string, message = 'A general question') => ({
  clientMessageId: id,
  message,
  uiLocale: 'en',
});

test('history HTTP contracts, persisted SSE IDs, replay and source lookup match FE adapter', async () => {
  let calls = 0;
  const repo = new Repository();
  const app = createApp(createDemoStore(clock), {
    repository: repo,
    model: mockModel({
      async reply() {
        calls++;
        return { en: 'Reply', zh: '回复' };
      },
    }),
  });
  const request = browser(app);
  const conv = ConversationSchema.parse(
    await (await request('/conversations', 'POST', { requestId: 'one' })).json(),
  );
  assert.equal(
    ConversationSchema.parse(
      await (await request('/conversations', 'POST', { requestId: 'one' })).json(),
    ).id,
    conv.id,
  );
  assert.equal(
    ConversationListResponseSchema.parse(await (await request('/conversations')).json()).items
      .length,
    0,
  );
  const stream = await events(
    await request('/conversations/' + conv.id + '/messages', 'POST', turnBody('m1')),
  );
  assert.equal(stream[0]!.payload.type, 'turn_accepted');
  assert.ok(stream.every((event, i) => event.eventIndex === i && event.conversationId === conv.id));
  const saved = ConversationMessagesResponseSchema.parse(
    await (await request('/conversations/' + conv.id + '/messages')).json(),
  );
  assert.equal(saved.conversation.latestTurn?.status, 'completed');
  assert.equal(saved.items.filter((entry) => entry.kind === 'tool').length, 1);
  assert.ok(saved.items.some((entry) => entry.kind === 'assistant'));
  assert.equal(
    (await request('/conversations/' + conv.id + '/messages/' + saved.items[0]!.id)).status,
    200,
  );
  const replay = await events(
    await request('/conversations/' + conv.id + '/messages', 'POST', turnBody('m1')),
  );
  assert.equal(calls, 1);
  assert.ok(replay[0]!.eventIndex > stream.at(-1)!.eventIndex);
  assert.equal(repo.allEntries('demo-lin', conv.id).length, saved.items.length);
  assert.equal(
    (await request('/conversations/' + conv.id + '/messages', 'POST', turnBody('m1', 'different')))
      .status,
    409,
  );
  assert.equal((await request('/conversations?limit=101')).status, 400);
  assert.equal((await request('/conversations?cursor=broken')).status, 400);
  await app.shutdown();
});
test('owner isolation covers existing business routes, histories, sources and suggestions', async () => {
  const repo = new Repository();
  const app = createApp(createDemoStore(clock), {
    repository: repo,
    resolveOwner: (request) => request.headers.get('X-Test-Owner') ?? 'demo-lin',
  });
  const a = browser(app, 'a');
  const b = browser(app, 'b');
  const conv = ConversationSchema.parse(
    await (await a('/conversations', 'POST', { requestId: 'own' })).json(),
  );
  await events(
    await a('/conversations/' + conv.id + '/messages', 'POST', turnBody('own-message', 'Thanks')),
  );
  const message = repo.allEntries('a', conv.id)[0]!;
  for (const [path, method] of [
    ['/conversations/' + conv.id, 'GET'],
    ['/conversations/' + conv.id + '/messages', 'GET'],
    ['/conversations/' + conv.id + '/messages/' + message.id, 'GET'],
    ['/conversations/' + conv.id, 'DELETE'],
  ])
    assert.equal((await b(path!, method!)).status, 404);
  assert.equal(
    (
      await b('/health-suggestions/foreign/start', 'POST', {
        requestId: 'bad',
        expectedSnapshotRevision: 0,
      })
    ).status,
    409,
  );
  assert.equal(
    ConversationListResponseSchema.parse(await (await b('/conversations')).json()).items.length,
    0,
  );
  await a('/notes', 'POST', { text: 'owner-a-only', bookingId: null });
  assert.deepEqual(await (await b('/notes')).json(), []);
  assert.equal(
    (await b('/conversations', 'POST', { requestId: 'forged', memberId: 'a' })).status,
    400,
  );
  await app.shutdown();
});
test('keyset pagination stays ordered when newer entries arrive', () => {
  const s = setup();
  const first = source(s, 'First');
  const second = source(s, 'Second');
  source(s, 'Third');
  const page = s.repo.page('demo-lin', 1);
  source(s, 'Newer');
  const next = s.repo.page('demo-lin', 10, page.nextCursor!);
  assert.ok(next.items.every((item) => item.id !== page.items[0]!.id));
  assert.throws(() => s.repo.messages('demo-lin', second.conv.id, 1, page.nextCursor!));
  source(s, 'Another message', first.conv);
  const messagePage = s.repo.messages('demo-lin', first.conv.id, 1);
  source(s, 'Yet another', first.conv);
  const remainder = s.repo.messages('demo-lin', first.conv.id, 100, messagePage.nextCursor!);
  assert.equal(remainder.items.length, 2);
  assert.ok(remainder.items.every((item) => item.order > messagePage.items[0]!.order));
  s.repo.close();
});
test('purpose off makes no extraction calls; on publishes source text, never model diagnosis', async () => {
  let calls = 0;
  const s = setup(
    mockModel({
      async extract(messages) {
        calls++;
        return fact(messages);
      },
    }),
  );
  source(s);
  assert.equal(s.health.refresh(s.store).status, 'disabled');
  assert.equal(calls, 0);
  const overview = await generate(s);
  HealthOverviewResponseSchema.parse(overview);
  assert.equal(overview.status, 'ready');
  assert.equal(calls, 1);
  assert.ok(!JSON.stringify(overview).includes('Unsupported diagnosis'));
  assert.equal(overview.facts[0]!.occurredAt.value, null);
  assert.equal(overview.facts[0]!.sources[0]!.reportedAt, clock().toISOString());
  assert.equal(s.health.refresh(s.store).status, 'up_to_date');
  assert.equal(calls, 1);
  s.repo.close();
});
for (const invalid of ['id', 'quote', 'date'])
  test('invalid model evidence fails closed: ' + invalid, async () => {
    const s = setup(
      mockModel({
        async extract(messages) {
          const result = fact(messages);
          const candidate = result.facts[0]!;
          if (invalid === 'id') candidate.evidence[0]!.messageId = 'foreign';
          if (invalid === 'quote') candidate.evidence[0]!.quote = 'Invented symptom';
          if (invalid === 'date')
            candidate.occurredAt = { precision: 'day', value: '2030-06-01T00:00:00Z' };
          return result;
        },
      }),
    );
    source(s);
    const overview = await generate(s);
    assert.equal(overview.status, 'error');
    assert.equal(overview.error?.code, 'INVALID_EVIDENCE');
    assert.equal(overview.facts.length, 0);
    assert.equal(overview.suggestions.length, 0);
    s.repo.close();
  });
test('older generation cannot overwrite a newer revision even if model ignores abort', async () => {
  const one = deferred<Extraction>();
  const two = deferred<Extraction>();
  const inputs: EvidenceMessage[][] = [];
  const s = setup(
    mockModel({
      async extract(messages) {
        inputs.push(messages);
        return inputs.length === 1 ? one.promise : two.promise;
      },
    }),
  );
  const original = source(s);
  s.health.setEnabled(s.ctx, true);
  s.health.refresh(s.store);
  await Promise.resolve();
  const oldJob = s.health.idle('demo-lin');
  source(s, 'The same arm is improving.', original.conv);
  s.health.refresh(s.store);
  await Promise.resolve();
  const newJob = s.health.idle('demo-lin');
  two.resolve(fact(inputs[1]!, 'reported_improving'));
  await newJob;
  const published = s.repo.overview('demo-lin');
  one.resolve(fact(inputs[0]!));
  await oldJob;
  assert.deepEqual(s.repo.overview('demo-lin'), published);
  assert.equal(published.facts[0]!.state, 'reported_improving');
  s.repo.close();
});
for (const action of ['off', 'delete'])
  test('late generation cannot revive content after ' + action, async () => {
    const delayed = deferred<Extraction>();
    let input: EvidenceMessage[] = [];
    const s = setup(
      mockModel({
        async extract(messages) {
          input = messages;
          return delayed.promise;
        },
      }),
    );
    const item = source(s);
    s.health.setEnabled(s.ctx, true);
    s.health.refresh(s.store);
    await Promise.resolve();
    const job = s.health.idle('demo-lin');
    if (action === 'off') s.health.setEnabled(s.ctx, false);
    else s.repo.removeConversation(s.store, item.conv.id);
    delayed.resolve(fact(input));
    await job;
    assert.equal(s.repo.overview('demo-lin').facts.length, 0);
    assert.equal(s.repo.states('demo-lin').length, 0);
    s.repo.close();
  });
test('source deletion clears multi-source details and derived chat, keeping independent user text', async () => {
  const s = setup(
    mockModel({
      async extract(messages) {
        return fact(messages);
      },
    }),
  );
  const a = source(s, 'I injured my arm on a bicycle.');
  const b = source(s, 'My same arm is still sore.');
  await generate(s);
  const followup = source(s, 'An independent question');
  s.repo.writeEntry(
    'demo-lin',
    {
      id: 'derived',
      conversationId: followup.conv.id,
      turnId: null,
      order: 1,
      createdAt: clock().toISOString(),
      kind: 'assistant',
      text: 'Bicycle injury',
      translation: '骑车受伤',
      suggestions: ['Bicycle'],
      sourceRefs: [a.ref, b.ref],
    },
    [a.ref, b.ref],
  );
  const removed = s.repo.removeConversation(s.store, a.conv.id);
  assert.equal(s.repo.overview('demo-lin').facts.length, 0);
  assert.equal(
    (s.repo.entry('demo-lin', followup.conv.id, 'derived') as { text: string }).text,
    '',
  );
  assert.equal(
    (s.repo.entry('demo-lin', followup.conv.id, followup.entry.id) as { text: string }).text,
    'An independent question',
  );
  assert.throws(() => s.repo.entry('demo-lin', a.conv.id, a.entry.id));
  assert.deepEqual(s.repo.removeConversation(s.store, a.conv.id), removed);
  s.health.refresh(s.store);
  await s.health.idle('demo-lin');
  assert.ok(!JSON.stringify(s.repo.overview('demo-lin')).includes('bicycle'));
  s.repo.close();
});
test('same-conversation context survives cross-conversation personalization turning off', async () => {
  const s = setup(
    mockModel({
      async extract(messages) {
        return fact(messages);
      },
    }),
  );
  const a = source(s, 'My arm hurts.');
  const b = source(s, 'Another question.');
  assert.ok(!JSON.stringify(s.health.context(s.ctx, b.conv.id)).includes('My arm hurts.'));
  await generate(s);
  assert.ok(JSON.stringify(s.health.context(s.ctx, b.conv.id)).includes('My arm hurts.'));
  s.health.setEnabled(s.ctx, false);
  assert.ok(!JSON.stringify(s.health.context(s.ctx, b.conv.id)).includes('My arm hurts.'));
  assert.ok(JSON.stringify(s.health.context(s.ctx, a.conv.id)).includes('My arm hurts.'));
  s.repo.close();
});
test('temporary mental-health permission never becomes persistent personalization input', async () => {
  let inputs: EvidenceMessage[] = [];
  const s = setup(
    mockModel({
      async extract(messages) {
        inputs = messages;
        return { facts: [] };
      },
    }),
  );
  const a = source(s, 'I feel anxious and overwhelmed.');
  source(s, 'My ankle is sore.');
  resolveConsent(
    s.ctx,
    requestConsent(s.ctx, ['mentalHealthNeed'], { sensitive: true }).id,
    'session',
  );
  assert.ok(JSON.stringify(s.health.context(s.ctx, a.conv.id)).includes('anxious'));
  await generate(s);
  assert.ok(inputs.every((message) => !message.text.includes('anxious')));
  closeSession(s.store, s.ctx.session);
  s.ctx.session = createSession(s.store);
  assert.ok(!JSON.stringify(s.health.context(s.ctx, a.conv.id)).includes('anxious'));
  s.repo.close();
});

function ready(s: ReturnType<typeof setup>, conversationId: string | null, slotIndex = 0) {
  let draft = createDraft(s.ctx, { prefill: { serviceType: 'gp', need: 'A reviewed concern' } });
  s.store.schedule.drafts.find((item) => item.id === draft.id)!.conversationId = conversationId;
  draft = patchDraft(s.ctx, draft.id, { step: 2 });
  draft = patchDraft(s.ctx, draft.id, { step: 3 });
  const provider = s.store.providers.find((item) => item.id === 'p-carlton-family')!;
  draft = patchDraft(s.ctx, draft.id, {
    step: 4,
    fields: { providerId: provider.id, slotId: provider.slots[slotIndex]!.id },
  });
  return patchDraft(s.ctx, draft.id, { step: 5 });
}
test('dismiss/start stay idempotent; booking, cancel and reprepare follow business state', async () => {
  const s = setup(
    mockModel({
      async extract(messages) {
        return fact(messages);
      },
    }),
  );
  source(s);
  let report = await generate(s);
  const update = report.suggestions.find((item) => item.action === 'update_status')!;
  s.health.dismiss('demo-lin', update.id, report.snapshotRevision);
  report = s.repo.overview('demo-lin');
  const suggestion = report.suggestions.find((item) => item.action === 'prepare_gp_booking')!;
  const command = { requestId: 'start', expectedSnapshotRevision: report.snapshotRevision };
  const started = s.health.start(s.store, suggestion.id, command);
  StartSuggestionResponseSchema.parse(started);
  assert.deepEqual(s.health.start(s.store, suggestion.id, command), started);
  assert.equal(s.store.schedule.bookings.length, 0);
  assert.equal(
    s.health.start(s.store, suggestion.id, {
      requestId: 'double',
      expectedSnapshotRevision: s.repo.overview('demo-lin').snapshotRevision,
    }).clientMessageId,
    started.clientMessageId,
  );
  const draft = ready(s, started.conversationId);
  const submitted = s.repo.atomic(s.store, () => {
    const value = submitDraft(s.ctx, draft.id);
    s.health.bookingChanged(s.store, value.booking.id);
    return value;
  });
  assert.equal(
    s.repo.states('demo-lin').find((item) => item.id === suggestion.id)!.state,
    'booked',
  );
  assert.equal(s.repo.overview('demo-lin').facts[0]!.state, 'unknown');
  assert.deepEqual(submitDraft(s.ctx, draft.id), submitted);
  assert.equal(s.store.schedule.bookings.length, 1);
  s.repo.atomic(s.store, () => {
    cancelBooking(s.ctx, submitted.booking.id);
    s.health.bookingChanged(s.store, submitted.booking.id);
  });
  assert.equal(
    s.repo.states('demo-lin').find((item) => item.id === suggestion.id)!.state,
    'cancelled',
  );
  const fresh = s.health.start(s.store, suggestion.id, {
    requestId: 'again',
    expectedSnapshotRevision: s.repo.overview('demo-lin').snapshotRevision,
  });
  assert.notEqual(fresh.clientMessageId, started.clientMessageId);
  assert.equal(fresh.conversationId, started.conversationId);
  assert.equal(s.repo.states('demo-lin').find((item) => item.id === update.id)!.state, 'dismissed');
  s.repo.close();
});
test('file database restart preserves business/history, expires controls and never reseeds deleted history', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'bupa-backend-'));
  const path = join(directory, 'test.sqlite');
  let repo = new Repository(path);
  const s = setup(mockModel(), repo);
  const item = source(s);
  setPermission(s.ctx, 'postcode', 'session');
  setPermission(s.ctx, 'preferredLanguage', 'always');
  const unfinished = createDraft(s.ctx, { prefill: { need: 'Temporary raw draft text' } });
  const booked = ready(s, item.conv.id);
  const result = s.repo.atomic(s.store, () => submitDraft(s.ctx, booked.id));
  const pending = repo.beginTurn(
    'demo-lin',
    item.conv.id,
    s.ctx.session.id,
    { ...turnBody('pending'), uiLocale: 'en', openDraftId: null, originSuggestionId: null },
    clock().toISOString(),
  );
  assert.ok(
    !String(repo.db.prepare('SELECT business FROM owners').get()!.business).includes(
      'Temporary raw draft text',
    ),
  );
  assert.equal(
    s.store.schedule.drafts.find((draft) => draft.id === booked.id)!.fields.need,
    undefined,
  );
  repo.close();
  repo = new Repository(path);
  const restored = repo.loadOwner('demo-lin', () => new Date('2030-06-04T00:00:00Z'), true);
  assert.equal(repo.turn('demo-lin', item.conv.id, pending.turn.id).status, 'interrupted');
  assert.equal(restored.sessions.size, 0);
  assert.equal(restored.schedule.drafts.length, 0);
  assert.equal(restored.profile.member.fields.postcode.permission, 'off');
  assert.equal(restored.profile.member.fields.preferredLanguage.permission, 'always');
  const ctx = { store: restored, session: createSession(restored) };
  assert.deepEqual(submitDraft(ctx, booked.id), result);
  assert.equal(restored.schedule.bookings[0]!.slot.startsAt, result.booking.slot.startsAt);
  const app = createApp(restored, { repository: repo });
  assert.equal((await app.request('/wizards/' + unfinished.id)).status, 404);
  repo.removeConversation(restored, item.conv.id);
  assert.equal(restored.schedule.bookings.length, 1);
  assert.equal(restored.submissions.get(booked.id)!.conversationId, null);
  await app.shutdown();
  repo = new Repository(path);
  repo.loadOwner('demo-lin', clock, true);
  assert.equal(repo.page('demo-lin', 30).items.length, 0);
  assert.equal(repo.db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get()!.v, 1);
  repo.close();
  // Only the newly created test directory is removed; never the application's database.
  assert.ok(directory.startsWith(join(tmpdir(), 'bupa-backend-')));
  rmSync(directory, { recursive: true, force: true });
});
test('accepted message commits before model; deletion during execution rejects late writes', async () => {
  const delayed = deferred<{ en: string; zh: string }>();
  const started = deferred<void>();
  const repo = new Repository();
  const app = createApp(createDemoStore(clock), {
    repository: repo,
    model: mockModel({
      async reply() {
        started.resolve();
        return delayed.promise;
      },
    }),
  });
  const request = browser(app);
  const conv = ConversationSchema.parse(
    await (await request('/conversations', 'POST', { requestId: 'race' })).json(),
  );
  const response = await request(
    '/conversations/' + conv.id + '/messages',
    'POST',
    turnBody('race'),
  );
  const streamText = response.text();
  await started.promise;
  assert.equal(repo.allEntries('demo-lin', conv.id)[0]!.kind, 'user');
  assert.equal(
    (await request('/conversations/' + conv.id + '/messages', 'POST', turnBody('race'))).status,
    409,
  );
  assert.equal((await request('/conversations/' + conv.id, 'DELETE')).status, 200);
  delayed.resolve({ en: 'Late forbidden reply', zh: '迟到内容' });
  await streamText;
  assert.throws(() => repo.conversation('demo-lin', conv.id));
  assert.equal(repo.db.prepare('SELECT COUNT(*) AS n FROM entries').get()!.n, 0);
  await app.shutdown();
});
test('cancelled consent turn expires persisted controls and frees execution lock', async () => {
  const repo = new Repository();
  const app = createApp(createDemoStore(clock), { repository: repo });
  const request = browser(app);
  const conv = ConversationSchema.parse(
    await (await request('/conversations', 'POST', { requestId: 'consent' })).json(),
  );
  const response = await request(
    '/conversations/' + conv.id + '/messages',
    'POST',
    turnBody('consent', 'Please book a GP'),
  );
  const reader = response.body!.getReader();
  let text = '';
  while (!text.includes('consent_request')) {
    const value = await reader.read();
    if (value.done) break;
    text += new TextDecoder().decode(value.value);
  }
  const turn = repo.conversation('demo-lin', conv.id).latestTurn!;
  assert.equal(
    (await request('/conversations/' + conv.id + '/turns/' + turn.id + '/cancel', 'POST')).status,
    200,
  );
  while (!(await reader.read()).done) {
    /* drain */
  }
  assert.equal(repo.conversation('demo-lin', conv.id).latestTurn!.status, 'interrupted');
  assert.ok(
    repo
      .allEntries('demo-lin', conv.id)
      .some((entry) => entry.kind === 'consent' && entry.status === 'expired'),
  );
  assert.equal(
    (
      await request(
        '/conversations/' + conv.id + '/messages',
        'POST',
        turnBody('consent', 'Please book a GP'),
      )
    ).status,
    409,
  );
  await events(
    await request('/conversations/' + conv.id + '/messages', 'POST', turnBody('next', 'Thanks')),
  );
  await app.shutdown();
});
test('manual draft belongs to one conversation and cannot be injected into another', async () => {
  const app = createApp(createDemoStore(clock));
  const request = browser(app);
  const a = ConversationSchema.parse(
    await (await request('/conversations', 'POST', { requestId: 'a' })).json(),
  );
  const b = ConversationSchema.parse(
    await (await request('/conversations', 'POST', { requestId: 'b' })).json(),
  );
  const response = await request('/wizards/booking', 'POST', { conversationId: a.id });
  assert.equal(response.status, 201);
  const draft = WizardDraftSchema.parse(await response.json());
  assert.equal(draft.conversationId, a.id);
  assert.equal(
    (
      await request('/conversations/' + b.id + '/messages', 'POST', {
        ...turnBody('other'),
        openDraftId: draft.id,
      })
    ).status,
    404,
  );
  await app.shutdown();
});
test('current safety blocks suggestions; historical severe descriptions stay historical', async () => {
  for (const text of ['Two weeks ago I had chest pain.', '两周前我胸痛。'])
    assert.equal(detectSafety(text), null);
  for (const text of [
    'I have had chest pain since this morning.',
    'Two weeks ago I had chest pain and I still have chest pain now.',
    '我现在呼吸困难',
  ])
    assert.ok(detectSafety(text));
  const s = setup(
    mockModel({
      async extract(messages) {
        return fact(messages);
      },
    }),
  );
  source(s, 'I have chest pain now.');
  const report = await generate(s);
  assert.equal(report.status, 'ready');
  assert.equal(report.suggestions.length, 0);
  s.repo.close();
});
test('context budget failure and missing model never silently substitute fictional health facts', async () => {
  const s = setup(null);
  source(s);
  assert.equal((await generate(s)).error?.code, 'MODEL_DISABLED');
  const small = new PersonalizationService(s.repo, mockModel(), 5);
  small.refresh(s.store);
  await small.idle('demo-lin');
  assert.equal(s.repo.overview('demo-lin').error?.code, 'CONTEXT_LIMIT');
  s.repo.close();
});
test('one source message can support distinct facts without merging the events', async () => {
  const s = setup(
    mockModel({
      async extract(messages) {
        const base = fact(messages).facts[0]!;
        return {
          facts: [
            { ...base, anchorQuote: 'My arm is sore.' },
            { ...base, anchorQuote: 'My ankle hurts.' },
          ],
        };
      },
    }),
  );
  source(s, 'My arm is sore. My ankle hurts.');
  const report = await generate(s);
  assert.equal(report.status, 'ready');
  assert.equal(report.facts.length, 2);
  assert.notEqual(report.facts[0]!.id, report.facts[1]!.id);
  s.repo.close();
});

test('new turn retains authorized cross-conversation context after invalidating report', async () => {
  const s = setup(
    mockModel({
      async extract(messages) {
        return fact(messages);
      },
    }),
  );
  source(s, 'My arm was injured.');
  await generate(s);
  const followup = source(s, 'What should I tell the GP about my arm?');
  assert.equal(s.repo.overview('demo-lin').status, 'pending');
  assert.ok(
    JSON.stringify(s.health.context(s.ctx, followup.conv.id)).includes('My arm was injured.'),
  );
  s.repo.close();
});
test('derived sensitive replies are excluded after session consent expires', () => {
  const s = setup();
  const original = source(s, 'I feel anxious.');
  s.repo.writeEntry(
    'demo-lin',
    {
      id: 'paraphrase',
      conversationId: original.conv.id,
      turnId: null,
      order: 1,
      createdAt: clock().toISOString(),
      kind: 'assistant',
      text: 'This is a paraphrase without category keywords.',
      translation: null,
      suggestions: [],
      sourceRefs: [original.ref],
    },
    [original.ref],
  );
  assert.equal(s.health.context(s.ctx, original.conv.id).context.messages.length, 0);
  resolveConsent(
    s.ctx,
    requestConsent(s.ctx, ['mentalHealthNeed'], { sensitive: true }).id,
    'session',
  );
  assert.equal(s.health.context(s.ctx, original.conv.id).context.messages.length, 2);
  s.repo.close();
});
test('atomic business failure rolls back booking, submission ledger and submitted draft', () => {
  const s = setup();
  const original = source(s);
  const draft = ready(s, original.conv.id);
  assert.throws(() =>
    s.repo.atomic(s.store, () => {
      submitDraft(s.ctx, draft.id);
      s.repo.writeEntry(
        'demo-lin',
        {
          id: 'invalid',
          conversationId: original.conv.id,
          turnId: null,
          order: 1,
          createdAt: clock().toISOString(),
          kind: 'assistant',
          text: 'Rejected',
          translation: null,
          suggestions: [],
          sourceRefs: [],
        },
        [{ ...original.ref, messageId: 'missing' }],
      );
    }),
  );
  assert.equal(s.store.submissions.size, 0);
  assert.equal(s.store.schedule.bookings.length, 0);
  assert.equal(s.store.schedule.drafts[0]!.status, 'draft');
  assert.equal(s.repo.allEntries('demo-lin').length, 1);
  assert.equal(
    s.repo.atomic(s.store, () => submitDraft(s.ctx, draft.id)).booking.status,
    'confirmed',
  );
  s.repo.close();
});
test('revoking the personalization receipt returns the existing receipt-list contract', async () => {
  const app = createApp(createDemoStore(clock), { model: mockModel() });
  const request = browser(app);
  const settings = (await (
    await request('/personalization', 'PATCH', { enabled: true })
  ).json()) as { receiptId: string };
  const response = await request('/receipts/' + settings.receiptId, 'DELETE');
  assert.equal(response.status, 200);
  assert.ok(Array.isArray(await response.json()));
  assert.equal(
    ((await (await request('/personalization')).json()) as { enabled: boolean }).enabled,
    false,
  );
  await app.shutdown();
});
test('reschedule updates the suggestion to the replacement booking', async () => {
  const s = setup(
    mockModel({
      async extract(messages) {
        return fact(messages);
      },
    }),
  );
  source(s);
  const report = await generate(s);
  const suggestion = report.suggestions.find((item) => item.action === 'prepare_gp_booking')!;
  const started = s.health.start(s.store, suggestion.id, {
    requestId: 'start',
    expectedSnapshotRevision: report.snapshotRevision,
  });
  const first = ready(s, started.conversationId);
  const original = s.repo.atomic(s.store, () => {
    const result = submitDraft(s.ctx, first.id);
    s.health.bookingChanged(s.store, result.booking.id);
    return result;
  });
  let replacement = createDraft(s.ctx, { rescheduleOf: original.booking.id });
  s.store.schedule.drafts.find((item) => item.id === replacement.id)!.conversationId =
    started.conversationId;
  replacement = patchDraft(s.ctx, replacement.id, { step: 2 });
  replacement = patchDraft(s.ctx, replacement.id, { step: 3 });
  const provider = s.store.providers.find((item) => item.id === 'p-carlton-family')!;
  replacement = patchDraft(s.ctx, replacement.id, {
    step: 4,
    fields: { providerId: provider.id, slotId: provider.slots[1]!.id },
  });
  replacement = patchDraft(s.ctx, replacement.id, { step: 5 });
  const result = s.repo.atomic(s.store, () => {
    const value = submitDraft(s.ctx, replacement.id);
    s.health.bookingChanged(s.store, value.booking.id);
    return value;
  });
  const state = s.repo.states('demo-lin').find((item) => item.id === suggestion.id)!;
  assert.equal(state.state, 'booked');
  assert.equal(state.bookingId, result.booking.id);
  assert.equal(
    s.store.schedule.bookings.find((item) => item.id === original.booking.id)!.status,
    'cancelled',
  );
  s.repo.close();
});
