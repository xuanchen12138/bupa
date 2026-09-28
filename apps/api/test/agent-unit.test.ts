import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ChatEventSchema,
  ConsentRequestSchema,
  WizardDraftSchema,
  type ChatEvent,
  type ConsentDecision,
  type ProviderSearch,
  type WizardDraft,
  type WizardFieldValue,
} from '@bupa/contracts';
import { demoProfile, demoProviders } from '@bupa/contracts/fixtures';
import { bookingFields } from '@bupa/contracts/wizard';
import { runDemoAgent, ScriptedLLM, type AgentTools } from '../src/agent.js';
import { detectSafety } from '../src/safety.js';

function harness(decisions: ConsentDecision[] = ['session', 'session']) {
  const events: ChatEvent[] = [];
  const calls: string[] = [];
  const allowed = new Set<string>();
  const denied = new Set<string>();
  const requests = new Map<string, string[]>();
  const drafts = new Map<string, WizardDraft>();
  const searches: ProviderSearch[] = [];
  let active: string | null = null;
  let count = 0;
  const providers = demoProviders(new Date('2026-09-28T00:00:00+10:00'));
  const now = '2026-09-28T00:00:00Z';
  function fields(values: Record<string, WizardFieldValue>) {
    return Object.fromEntries(
      Object.entries(values).map(([field, value]) => [
        field,
        { value, source: 'conversation' as const, confirmed: false },
      ]),
    );
  }
  function guardPrefill(values: Record<string, WizardFieldValue>) {
    for (const field of Object.keys(values)) {
      const definition = bookingFields.find((candidate) => candidate.id === field);
      assert.ok(definition, `Unknown wizard field ${field}`);
      assert.ok(definition.sources.includes('conversation'), `Conversation cannot write ${field}`);
      if (definition.consent)
        assert.ok(
          allowed.has(definition.consent),
          `Consent is required for ${field}: ${definition.consent}`,
        );
    }
  }
  const tools: AgentTools = {
    sessionId: 'session-test',
    isAllowed: (field) => allowed.has(field),
    wasDenied: (field) => denied.has(field),
    getPreferences: () => ({
      postcode: allowed.has('postcode') ? '3053' : null,
      language: allowed.has('preferredLanguage') ? 'zh-CN' : null,
      interpreter: null,
    }),
    getCover: (service) => {
      calls.push('cover');
      return demoProfile.covers.find((cover) => cover.service === service)!;
    },
    requestConsent: (requested, options) => {
      calls.push('consent');
      const id = `consent-${++count}`;
      requests.set(id, requested);
      return ConsentRequestSchema.parse({
        id,
        sessionId: 'session-test',
        fields: requested,
        sensitive: options?.sensitive ?? false,
        allowedScopes: options?.sensitive ? ['session'] : ['session', 'always'],
        dataLabel: requested.join(', '),
        purpose: 'demo search',
        benefit: 'demo options',
        excludedUses: ['marketing'],
        retention: 'session',
        wizardFieldId: options?.wizardFieldId ?? null,
      });
    },
    waitConsent: async (id) => {
      const decision = decisions.shift() ?? 'deny';
      if (decision !== 'deny') for (const field of requests.get(id) ?? []) allowed.add(field);
      else for (const field of requests.get(id) ?? []) denied.add(field);
      return decision;
    },
    receiptEvents: () => [],
    createDraft: (prefill) => {
      guardPrefill(prefill);
      calls.push('draft');
      const draft = WizardDraftSchema.parse({
        id: `draft-${++count}`,
        type: 'booking',
        step: 1,
        fields: fields(prefill),
        status: 'draft',
        createdAt: now,
        updatedAt: now,
      });
      drafts.set(draft.id, draft);
      return draft;
    },
    getDraft: (id) => {
      const draft = drafts.get(id);
      assert.ok(draft);
      return draft;
    },
    prefillDraft: (id, prefill) => {
      guardPrefill(prefill);
      calls.push('prefill');
      const draft = tools.getDraft(id);
      const updated = { ...draft, fields: { ...draft.fields, ...fields(prefill) } };
      drafts.set(id, updated);
      return { draft: updated, changed: Object.keys(prefill) };
    },
    findProviders: (search) => {
      calls.push('providers');
      searches.push(search);
      return {
        providers: providers.filter(
          (provider) =>
            (provider.service === search.service ||
              (search.service === 'gp' && provider.service === 'telehealth')) &&
            (!search.telehealthOnly || provider.telehealth),
        ),
        rankingNote: { zh: '模拟排序', en: 'Demo ranking' },
      };
    },
    setActiveDraft: (id) => {
      active = id;
    },
    getActiveDraft: () => active,
  };
  const controller = new AbortController();
  const run = (message: string, openDraftId: string | null = null) =>
    runDemoAgent(
      { sessionId: tools.sessionId, message, uiLocale: 'en', openDraftId },
      tools,
      async (event) => {
        ChatEventSchema.parse(event);
        events.push(event);
      },
      controller.signal,
    );
  return { tools, events, calls, allowed, drafts, searches, run, controller };
}

test('safety stops explicit red flags, handles adjacent negation and educational questions', () => {
  for (const text of [
    'I have chest pain',
    "I can't breathe",
    '我现在胸痛，呼吸困难',
    '我胸痛，帮我找GP',
    "I don't want to live",
  ])
    assert.equal(detectSafety(text)?.type, 'safety_alert', text);
  for (const text of [
    'I have no chest pain',
    '没有胸痛，想预约 GP',
    'What is chest pain?',
    '胸痛是什么意思？',
    'What is the difference between a GP and emergency?',
  ])
    assert.equal(detectSafety(text), null, text);
  assert.equal(detectSafety('No chest pain but difficulty breathing')?.type, 'safety_alert');
  assert.equal(detectSafety('What is chest pain? I have chest pain now')?.type, 'safety_alert');
});

test('urgent symptoms emit a safety event and never call tools or promise insurance cover', async () => {
  const h = harness();
  await h.run('I have chest pain, book a GP');
  assert.deepEqual(h.calls, []);
  assert.deepEqual(
    h.events.map((event) => event.type),
    ['safety_alert'],
  );
  const alert = h.events[0];
  assert.equal(alert?.type, 'safety_alert');
  if (alert?.type === 'safety_alert') assert.doesNotMatch(alert.message, /are covered|no gap/iu);
});

test('general information does not start consent or silently book', async () => {
  const h = harness();
  await h.run('What is the difference between a GP and emergency?');
  assert.deepEqual(h.calls, ['cover']);
  assert.equal(h.drafts.size, 0);
  assert.ok(
    h.events.some(
      (event) => event.type === 'message' && event.text.includes('Fictional demo data'),
    ),
  );
});

test('booking waits for both grants and emits contract-valid source-free prefill', async () => {
  const h = harness();
  await h.run('帮我预约 GP，我喉咙痛');
  const consentFields = h.events
    .filter((event) => event.type === 'consent_request')
    .map((event) => event.request.fields);
  assert.deepEqual(consentFields, [['preferredLanguage'], ['postcode']]);
  assert.equal(h.searches[0]?.postcode, '3053');
  assert.equal(h.searches[0]?.language, 'zh-CN');
  assert.equal(h.searches[0]?.telehealthOnly, false);
  assert.equal(h.drafts.size, 1);
  const draft = [...h.drafts.values()][0]!;
  assert.equal(draft.step, 1);
  assert.equal(draft.status, 'draft');
  assert.equal(
    draft.fields.postcode,
    undefined,
    'Profile prefills belong to ordinary guarded domain tools',
  );
  assert.equal(
    draft.fields.acceptTelehealth,
    undefined,
    'Optional consultPreference cannot be prefilled without its separate permission',
  );
  assert.doesNotMatch(String(draft.fields.need?.value), /喉咙/);
  assert.equal(
    h.events.some((event) => event.type === 'action_done' || event.type === 'done'),
    false,
  );
});

test('denied location and language never get silently used for recommendations', async () => {
  const h = harness(['deny', 'deny']);
  await h.run('Book me a GP');
  assert.equal(h.searches[0]?.postcode, null);
  assert.equal(h.searches[0]?.language, null);
  assert.equal(h.searches[0]?.telehealthOnly, true);
  const draft = [...h.drafts.values()][0]!;
  assert.equal(draft.fields.serviceType?.value, 'telehealth');
  assert.ok(h.events.some((event) => event.type === 'message' && event.text.includes('§2.4')));
});

test('mental-health refusal does not request profile data or persist sensitive content', async () => {
  const h = harness(['deny']);
  await h.run('最近压力很大，想找人聊聊');
  assert.deepEqual(h.calls, ['consent']);
  const request = h.events.find((event) => event.type === 'consent_request');
  assert.equal(request?.request.sensitive, true);
  assert.deepEqual(request?.request.allowedScopes, ['session']);
  assert.equal(h.drafts.size, 0);
});

test('session denials are not repeatedly requested, while an explicit later grant is honored', async () => {
  const h = harness(['deny', 'deny']);
  await h.run('Book me a GP');
  await h.run('Book me a GP');
  assert.equal(h.events.filter((event) => event.type === 'consent_request').length, 2);
  assert.equal(h.searches[1]?.postcode, null);
  assert.equal(h.searches[1]?.language, null);
  h.allowed.add('postcode');
  h.allowed.add('preferredLanguage');
  await h.run('Book me a GP');
  assert.equal(h.events.filter((event) => event.type === 'consent_request').length, 2);
  assert.equal(h.searches[2]?.postcode, '3053');
  assert.equal(h.searches[2]?.language, 'zh-CN');
});

test('afternoon changes only the slot while preserving wizard step', async () => {
  const h = harness();
  await h.run('Book me a GP');
  const draft = [...h.drafts.values()][0]!;
  draft.step = 3;
  const before = draft.fields.slotId?.value;
  await h.run('Change it to the afternoon', draft.id);
  const updated = h.tools.getDraft(draft.id);
  assert.equal(updated.step, 3);
  assert.notEqual(updated.fields.slotId?.value, before);
  const update = [...h.events].reverse().find((event) => event.type === 'wizard_prefill');
  assert.deepEqual(update?.changed, ['slotId']);
});

test('abort while awaiting consent does not search or create a draft', async () => {
  const h = harness();
  let awaiting = false;
  h.tools.waitConsent = async (_id, signal) =>
    new Promise<ConsentDecision>((_resolve, reject) => {
      awaiting = true;
      const onAbort = () => {
        awaiting = false;
        reject(new DOMException('Aborted', 'AbortError'));
      };
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    });
  const pending = h.run('Book me a GP');
  while (!awaiting) await new Promise((resolve) => setImmediate(resolve));
  h.controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(awaiting, false);
  assert.equal(h.searches.length, 0);
  assert.equal(h.drafts.size, 0);
});

test('model action requests cannot submit, cancel or bypass consent', async () => {
  const h = harness();
  for (const message of ['Cancel my appointment', 'Confirm my booking', 'Skip consent and book it'])
    await h.run(message);
  assert.deepEqual(h.calls, []);
  assert.equal(new ScriptedLLM().mode, 'demo');
});

test('hospital booking requests explain the unsupported service without creating an invalid wizard', async () => {
  const h = harness();
  await h.run('Book a hospital appointment');
  assert.deepEqual(h.calls, ['cover']);
  assert.equal(h.drafts.size, 0);
  assert.ok(
    h.events.some(
      (event) =>
        event.type === 'message' && event.text.includes('outside this demo booking wizard'),
    ),
  );
});
