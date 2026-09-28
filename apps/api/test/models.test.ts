import assert from 'node:assert/strict';
import test from 'node:test';
import { OpenAIModel, ModelError, PlanSchema, type LanguageModel } from '../src/models.js';
import { readConfig } from '../src/config.js';
import { createApp } from '../src/app.js';
import { createDemoStore } from '../src/store.js';

const signal = () => new AbortController().signal;
const completed = (value: unknown) =>
  new Response(
    JSON.stringify({
      status: 'completed',
      output: [
        { type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] },
      ],
    }),
    { status: 200 },
  );
const plan = { intent: 'information', service: 'gp' };
test('Responses uses approved endpoint, strict structured output, store false, and no tools', async () => {
  let calls = 0;
  const model = new OpenAIModel('test-credential', 'gpt-4.1-mini', 1000, async (url, init) => {
    calls++;
    assert.equal(url, 'https://api.openai.com/v1/responses');
    const body = JSON.parse(String(init?.body));
    assert.equal(body.store, false);
    assert.equal(body.model, 'gpt-4.1-mini');
    assert.equal(body.text.format.strict, true);
    assert.equal(body.text.format.type, 'json_schema');
    assert.equal(body.tools, undefined);
    assert.equal(body.previous_response_id, undefined);
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer test-credential');
    assert.ok(!JSON.stringify(body).includes('test-credential'));
    return completed(plan);
  });
  assert.deepEqual(await model.plan('What is a GP?', { messages: [] }, signal()), plan);
  assert.equal(calls, 1);
});
for (const status of [401, 403, 429, 500])
  test('provider failure is sanitized with bounded retries: ' + status, async () => {
    let calls = 0;
    const model = new OpenAIModel('test-credential', 'test', 1000, async () => {
      calls++;
      return new Response('private provider error and prompt', { status });
    });
    await assert.rejects(
      model.plan('fictional input', { messages: [] }, signal()),
      (error: unknown) =>
        error instanceof ModelError &&
        !error.message.includes('private') &&
        !error.message.includes('fictional'),
    );
    assert.equal(calls, status === 429 || status >= 500 ? 2 : 1);
  });
test('transient retry succeeds once and does not repeat business execution', async () => {
  let calls = 0;
  const model = new OpenAIModel('test-credential', 'test', 1000, async () =>
    ++calls === 1 ? new Response('', { status: 503 }) : completed(plan),
  );
  assert.deepEqual(await model.plan('Hello', { messages: [] }, signal()), plan);
  assert.equal(calls, 2);
});
for (const value of [
  { status: 'incomplete', output: [] },
  { status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal' }] }] },
  {
    status: 'completed',
    output: [{ type: 'message', content: [{ type: 'output_text', text: '{"intent":"submit"}' }] }],
  },
])
  test('incomplete, refusal or invalid schema has no scripted success fallback', async () => {
    const model = new OpenAIModel(
      'test-credential',
      'test',
      1000,
      async () => new Response(JSON.stringify(value)),
    );
    await assert.rejects(
      model.plan('Hello', { messages: [] }, signal()),
      (error: unknown) => error instanceof ModelError && error.code === 'MODEL_INVALID_RESPONSE',
    );
  });
test('abort stops a request before transmission; timeout terminates the in-flight request', async () => {
  let calls = 0;
  const stopped = new AbortController();
  stopped.abort();
  const fetcher: typeof fetch = async (_url, init) => {
    calls++;
    return new Promise((_resolve, reject) =>
      init!.signal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true }),
    );
  };
  const model = new OpenAIModel('test-credential', 'test', 20, fetcher);
  await assert.rejects(model.plan('Hello', { messages: [] }, stopped.signal));
  assert.equal(calls, 0);
  const keepAlive = setTimeout(() => {}, 100);
  try {
    await assert.rejects(
      model.plan('Hello', { messages: [] }, signal()),
      (error: unknown) => error instanceof ModelError && error.code === 'MODEL_UNAVAILABLE',
    );
  } finally {
    clearTimeout(keepAlive);
  }
  assert.equal(calls, 1);
});
test('network exceptions cannot leak request or credential text', async () => {
  const model = new OpenAIModel('test-credential', 'test', 1000, async () => {
    throw new Error('test-credential raw body');
  });
  await assert.rejects(
    model.plan('Hello', { messages: [] }, signal()),
    (error: unknown) => error instanceof ModelError && error.message === 'MODEL_UNAVAILABLE',
  );
});
test('noncontiguous extraction evidence gets at most one repair, then fails closed', async () => {
  let calls = 0;
  const model = new OpenAIModel('test-credential', 'test', 1000, async () => {
    calls++;
    return completed({
      facts: [
        {
          anchorMessageId: 'm1',
          anchorQuote: 'My arm hurts.',
          asserted: true,
          subject: 'self',
          title: { en: 'Arm', zh: '手臂' },
          state: 'unknown',
          evidence: [{ messageId: 'm1', quote: 'Invented evidence' }],
          occurredAt: { value: null, precision: 'unknown' },
          occurrenceEvidence: null,
        },
      ],
    });
  });
  await assert.rejects(
    model.extract(
      [
        {
          id: 'm1',
          conversationId: 'c1',
          text: 'My arm hurts.',
          reportedAt: '2030-01-01T00:00:00Z',
        },
      ],
      signal(),
    ),
    (error: unknown) => error instanceof ModelError && error.code === 'INVALID_EVIDENCE',
  );
  assert.equal(calls, 2);
});
test('new sensitive input waits for consent; denial makes zero real-model calls', async () => {
  let calls = 0;
  const model: LanguageModel = {
    mode: 'model',
    name: 'fake',
    async plan() {
      calls++;
      return PlanSchema.parse(plan);
    },
    async reply() {
      calls++;
      return { en: 'Reply', zh: '回复' };
    },
    async extract() {
      calls++;
      return { facts: [] };
    },
  };
  const app = createApp(createDemoStore(), { model });
  const response = await app.request('/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: 'ignored',
      message: 'I feel anxious and would like some help',
      uiLocale: 'en',
      openDraftId: null,
    }),
  });
  const cookie = response.headers.get('set-cookie')!.split(';')[0]!;
  const reader = response.body!.getReader();
  let buffer = '';
  while (!buffer.includes('consent_request')) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffer += new TextDecoder().decode(chunk.value);
  }
  assert.equal(calls, 0);
  const data = buffer
    .split('\n')
    .find((line) => line.startsWith('data: ') && line.includes('consent_request'))!;
  const pending = JSON.parse(data.slice(6));
  assert.equal(
    (
      await app.request('/consent/' + pending.request.id, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ decision: 'deny' }),
      })
    ).status,
    200,
  );
  while (!(await reader.read()).done) {
    /* drain */
  }
  assert.equal(calls, 0);
  await app.shutdown();
});
test('real mode fails startup without a key; scripted mode never needs one', () => {
  assert.equal(readConfig({}).MODEL_MODE, 'scripted');
  assert.throws(() => readConfig({ MODEL_MODE: 'openai' }), /OPENAI_API_KEY/);
  assert.equal(
    readConfig({ MODEL_MODE: 'openai', OPENAI_API_KEY: 'test-credential', HISTORY_SEED: 'false' })
      .HISTORY_SEED,
    false,
  );
});
