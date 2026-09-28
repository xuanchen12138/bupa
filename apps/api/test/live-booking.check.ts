import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { OpenAIModel } from '../src/models.js';
import { loadConfig, projectRoot } from '../src/runtime.js';
import { Repository } from '../src/repository.js';
import { createApp } from '../src/app.js';
import {
  ConversationSchema,
  ConversationStreamEventSchema,
  HealthOverviewResponseSchema,
  StartSuggestionResponseSchema,
  WizardDraftSchema,
  BookingSchema,
} from '@bupa/contracts';
const config = loadConfig();
if (config.MODEL_MODE !== 'openai' || !config.OPENAI_API_KEY)
  throw new Error('Real model configuration required.');
const repo = new Repository();
const model = new OpenAIModel(config.OPENAI_API_KEY, config.OPENAI_MODEL, config.MODEL_TIMEOUT_MS);
const app = createApp(undefined, { repository: repo, model });
let cookie = '';
async function request(path: string, method = 'GET', body?: unknown) {
  const response = await app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  cookie = response.headers.get('set-cookie')?.split(';')[0] ?? cookie;
  assert.ok(response.ok, path + ': HTTP ' + response.status);
  return response;
}
async function stream(path: string, body: unknown) {
  const response = await request(path, 'POST', body);
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const events = [];
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    let boundary: number;
    while ((boundary = buffer.indexOf('\n\n')) >= 0) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const data = frame.split('\n').find((line) => line.startsWith('data: '));
      if (!data) continue;
      const event = ConversationStreamEventSchema.parse(JSON.parse(data.slice(6)));
      events.push(event);
      // This test only uses fictional profiles and explicitly authorizes session reuse.
      if (event.payload.type === 'consent_request')
        await request('/consent/' + event.payload.request.id, 'POST', { decision: 'session' });
      assert.notEqual(event.payload.type, 'error', 'Model execution must not return an error');
    }
  }
  assert.equal(events.at(-1)?.payload.type, 'done');
  return events;
}
const checks: string[] = [];
let failure: string | null = null;
try {
  const conversation = ConversationSchema.parse(
    await (await request('/conversations', 'POST', { requestId: 'live-booking-source' })).json(),
  );
  await stream('/conversations/' + conversation.id + '/messages', {
    clientMessageId: 'source',
    message: '这是虚构测试。我两周前伤了手臂，现在好一些但还不舒服。请帮我记录这段自述。',
    uiLocale: 'zh',
  });
  await request('/personalization', 'PATCH', { enabled: true });
  const deadline = Date.now() + 65000;
  while (repo.overview('demo-lin').status === 'pending' && Date.now() < deadline)
    await new Promise((done) => setTimeout(done, 100));
  const overview = HealthOverviewResponseSchema.parse(
    await (await request('/health-overview')).json(),
  );
  assert.equal(overview.status, 'ready');
  assert.equal(overview.facts[0]?.state, 'reported_improving');
  checks.push('Real extraction preserves improving status and source references.');
  const suggestion = overview.suggestions.find((item) => item.action === 'prepare_gp_booking')!;
  const started = StartSuggestionResponseSchema.parse(
    await (
      await request('/health-suggestions/' + suggestion.id + '/start', 'POST', {
        requestId: 'start',
        expectedSnapshotRevision: overview.snapshotRevision,
      })
    ).json(),
  );
  const events = await stream('/conversations/' + started.conversationId + '/messages', {
    clientMessageId: started.clientMessageId,
    message: started.initialMessage.zh,
    originSuggestionId: started.originSuggestionId,
    uiLocale: 'zh',
  });
  const opened = events.find((event) => event.payload.type === 'wizard_open');
  assert.ok(opened?.payload.type === 'wizard_open');
  const draft = WizardDraftSchema.parse(opened.payload.draft);
  assert.equal(draft.conversationId, started.conversationId);
  assert.ok(String(draft.fields.need?.value).includes('手臂'));
  assert.equal(draft.fields.need?.source, 'conversation');
  assert.equal(
    ((await (await request('/schedule')).json()) as { bookings: unknown[] }).bookings.length,
    0,
  );
  checks.push(
    'Real plan and reply open a source-linked draft after consent; no automatic booking.',
  );
  for (const step of [2, 3, 4, 5]) await request('/wizards/' + draft.id, 'PATCH', { step });
  const submitted = (await (await request('/wizards/' + draft.id + '/submit', 'POST')).json()) as {
    booking: unknown;
  };
  const booking = BookingSchema.parse(submitted.booking);
  const repeated = (await (await request('/wizards/' + draft.id + '/submit', 'POST')).json()) as {
    booking: { id: string };
  };
  assert.equal(repeated.booking.id, booking.id);
  assert.equal(repo.states('demo-lin').find((item) => item.id === suggestion.id)?.state, 'booked');
  assert.equal(repo.overview('demo-lin').facts[0]?.state, 'reported_improving');
  checks.push(
    'Five explicit review steps and idempotent submit produce one fictional booking; booking is not recovery.',
  );
  await request('/conversations/' + conversation.id, 'DELETE');
  assert.equal(repo.overview('demo-lin').facts.length, 0);
  const schedule = (await (await request('/schedule')).json()) as { bookings: { id: string }[] };
  assert.equal(schedule.bookings[0]?.id, booking.id);
  assert.ok(
    !repo
      .allEntries('demo-lin', started.conversationId)
      .some(
        (entry) =>
          (entry.kind === 'user' || entry.kind === 'assistant') && entry.text.includes('手臂'),
      ),
  );
  checks.push(
    'Delete original source removes derived chat/report while retaining the user-confirmed booking.',
  );
} catch (error) {
  failure = error instanceof Error ? error.message : 'Failed';
  process.exitCode = 1;
} finally {
  await app.shutdown();
}
const report = {
  executedAt: new Date().toISOString(),
  provider: 'OpenAI Responses',
  model: config.OPENAI_MODEL,
  data: 'fictional only',
  passed: failure === null,
  checks,
  failure,
};
writeFileSync(
  resolve(projectRoot, 'docs/backend-live-booking-eval.json'),
  JSON.stringify(report, null, 2) + '\n',
);
console.info(
  'Real model booking flow: ' +
    (failure ? 'FAIL ' + failure : 'PASS') +
    ' (' +
    checks.length +
    ' checkpoints).',
);
