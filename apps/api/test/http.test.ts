import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import {
  ApiErrorSchema,
  BookingSchema,
  ChatEventSchema,
  ConsentRequestSchema,
  HealthResponseSchema,
  ProfileResponseSchema,
  ProviderSchema,
  ProviderSearchResultSchema,
  ReceiptSchema,
  ScheduleSchema,
  WizardDraftSchema,
  type ChatEvent,
  type ConsentDecision,
} from '@bupa/contracts';
import { createApp } from '../src/app.js';
import { createDemoStore } from '../src/store.js';

const CLOCK = new Date('2030-06-03T00:00:00Z');
const Receipts = z.array(ReceiptSchema);
const Submit = z.object({ booking: BookingSchema, receipt: ReceiptSchema });
const ConsentReply = z.object({ request: ConsentRequestSchema });

function createHarness() {
  const store = createDemoStore(() => new Date(CLOCK));
  const app = createApp(store);
  return { store, app };
}

/** Like the current same-origin browser adapter: only the cookie carries server identity. */
function browser(app: ReturnType<typeof createApp>) {
  let cookie = '';
  async function request(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    if (cookie) headers.set('Cookie', cookie);
    const response = await app.request(path, { ...init, headers });
    const updated = response.headers.get('set-cookie');
    if (updated) cookie = updated.split(';')[0] ?? '';
    return response;
  }
  async function json<T>(path: string, schema: z.ZodType<T>, method = 'GET', body?: unknown) {
    const response = await request(path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data: unknown = await response.json();
    assert.ok(response.ok, `${method} ${path}: ${response.status} ${JSON.stringify(data)}`);
    return schema.parse(data);
  }
  return {
    request,
    json,
    get cookie() {
      return cookie;
    },
  };
}

type Browser = ReturnType<typeof browser>;

async function error(response: Response, expectedStatus: number) {
  assert.equal(response.status, expectedStatus);
  return ApiErrorSchema.parse(await response.json()).error;
}

function consentBody(fields: string[], sensitive = false) {
  return {
    fields,
    sensitive,
    dataLabel: 'Requested demo information',
    purpose: 'Prepare the requested booking',
    benefit: 'Relevant demo options',
    excludedUses: ['Marketing'],
    retention: 'Until revoked',
    allowedScopes: ['session', 'always'],
    wizardFieldId: null,
  };
}

async function readyDraft(client: Browser, input: { rescheduleOf?: string; slotId?: string } = {}) {
  const draft = await client.json('/wizards/booking', WizardDraftSchema, 'POST', {
    prefill: { serviceType: 'gp', need: 'General consultation' },
    ...(input.rescheduleOf ? { rescheduleOf: input.rescheduleOf } : {}),
  });
  const search = await client.json('/providers/search', ProviderSearchResultSchema, 'POST', {
    service: 'gp',
    postcode: null,
    language: null,
    telehealthOnly: false,
  });
  const provider = search.providers[0];
  assert.ok(provider);
  const slot = input.slotId
    ? provider.slots.find((item) => item.id === input.slotId)
    : provider.slots[0];
  assert.ok(slot);
  await client.json(`/wizards/${draft.id}`, WizardDraftSchema, 'PATCH', { step: 2 });
  await client.json(`/wizards/${draft.id}`, WizardDraftSchema, 'PATCH', { step: 3 });
  await client.json(`/wizards/${draft.id}`, WizardDraftSchema, 'PATCH', {
    fields: { providerId: provider.id, slotId: slot.id },
  });
  await client.json(`/wizards/${draft.id}`, WizardDraftSchema, 'PATCH', { step: 4 });
  await client.json(`/wizards/${draft.id}`, WizardDraftSchema, 'PATCH', {
    fields: {
      patientName: 'Lin Zhao',
      memberNumber: 'DEMO-4D-000123',
      phone: '04xx xxx 123',
      notes: 'Please explain the next steps.',
    },
  });
  const ready = await client.json(`/wizards/${draft.id}`, WizardDraftSchema, 'PATCH', { step: 5 });
  assert.equal(ready.step, 5);
  return ready;
}

async function withDeadline<T>(promise: Promise<T>, ms = 3000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('SSE did not make progress before the deadline.')),
          ms,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function* events(reader: ReadableStreamDefaultReader<Uint8Array>): AsyncGenerator<ChatEvent> {
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const chunk = await withDeadline(reader.read());
    if (chunk.done) {
      assert.equal(buffer.trim(), '', 'SSE stream must end at an event boundary');
      return;
    }
    buffer += decoder.decode(chunk.value, { stream: true });
    let boundary: number;
    while ((boundary = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const data = block
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())
        .join('\n');
      if (data) yield ChatEventSchema.parse(JSON.parse(data));
    }
  }
}

async function openChat(client: Browser, message = '帮我预约一个 GP') {
  // Establish the cookie before opening a long-lived POST, just as profile loading does in the UI.
  await client.json('/profile', ProfileResponseSchema);
  const response = await client.request('/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({ sessionId: 'session-demo', message, uiLocale: 'zh', openDraftId: null }),
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /text\/event-stream/);
  assert.ok(response.body);
  return response.body.getReader();
}

test('HTTP reads match current contracts and create a server-owned browser cookie', async () => {
  const { app } = createHarness();
  const client = browser(app);
  await client.json('/health', HealthResponseSchema);
  const response = await client.request('/profile');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  ProfileResponseSchema.parse(await response.json());
  assert.match(client.cookie, /^bupa_session=/);
  assert.ok(!client.cookie.includes('session-demo'));
  // A fresh response establishes HttpOnly and SameSite protections.
  const fresh = await app.request('/profile');
  assert.match(fresh.headers.get('set-cookie') ?? '', /HttpOnly/i);
  assert.match(fresh.headers.get('set-cookie') ?? '', /SameSite=/i);
  await client.json('/schedule', ScheduleSchema);
  assert.deepEqual(await client.json('/receipts', Receipts), []);
  assert.equal(await client.json('/providers/not-a-provider', ProviderSchema.nullable()), null);
});

test('invalid JSON, oversized bodies and invalid profile fields fail without partial writes', async () => {
  const { app } = createHarness();
  const client = browser(app);
  const before = await client.json('/profile', ProfileResponseSchema);
  await error(
    await client.request('/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: '{',
    }),
    400,
  );
  await error(
    await client.request('/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { name: 'Changed before validation', postcode: 'invalid' } }),
    }),
    400,
  );
  await error(
    await client.request('/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { name: 'x'.repeat(70 * 1024) } }),
    }),
    413,
  );
  assert.deepEqual(await client.json('/profile', ProfileResponseSchema), before);
  assert.equal((await client.json('/schedule', ScheduleSchema)).bookings.length, 0);
});

test('grant and revoke leave an audit receipt while clearing automatic, not manual, draft data', async () => {
  const { app } = createHarness();
  const client = browser(app);
  const profile = await client.json('/profile/permissions', ProfileResponseSchema, 'PATCH', {
    field: 'postcode',
    permission: 'session',
  });
  assert.equal(profile.member.fields.postcode.permission, 'session');
  const auto = await client.json('/wizards/booking', WizardDraftSchema, 'POST', {});
  const manual = await client.json('/wizards/booking', WizardDraftSchema, 'POST', {
    prefill: { postcode: '3000' },
  });
  assert.equal(auto.fields.postcode?.value, '3053');
  assert.equal(auto.fields.postcode?.source, 'profile');
  const receipts = await client.json('/receipts', Receipts);
  const receipt = receipts.find((item) => item.kind === 'data' && item.fields.includes('postcode'));
  assert.ok(receipt);
  assert.equal(receipt.scope, 'session');
  const revoked = await client.json(`/receipts/${receipt.id}`, Receipts, 'DELETE');
  assert.equal(revoked.find((item) => item.id === receipt.id)?.status, 'revoked');
  assert.equal(
    (await client.json('/profile', ProfileResponseSchema)).member.fields.postcode.permission,
    'off',
  );
  const cleared = await client.json(`/wizards/${auto.id}`, WizardDraftSchema);
  assert.ok(cleared.fields.postcode?.value == null);
  const preserved = await client.json(`/wizards/${manual.id}`, WizardDraftSchema);
  assert.equal(preserved.fields.postcode?.value, '3000');
  assert.equal(preserved.fields.postcode?.source, 'user');
  assert.deepEqual(await client.json(`/receipts/${receipt.id}`, Receipts, 'DELETE'), revoked);
});

test('sensitive consent cannot be widened by request metadata and responses are idempotent', async () => {
  const { app } = createHarness();
  const client = browser(app);
  const request = await client.json('/consent', ConsentRequestSchema, 'POST', {
    ...consentBody(['mentalHealthNeed']),
    sensitive: false,
    allowedScopes: ['always'],
  });
  assert.equal(request.sensitive, true);
  assert.deepEqual(request.allowedScopes, ['session']);
  await error(
    await client.request(`/consent/${request.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'always' }),
    }),
    400,
  );
  const granted = await client.json(`/consent/${request.id}`, ConsentReply, 'POST', {
    decision: 'session',
  });
  assert.equal(granted.request.status, 'granted');
  const receipts = await client.json('/receipts', Receipts);
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0]?.sensitive, true);
  await client.json(`/consent/${request.id}`, ConsentReply, 'POST', { decision: 'session' });
  assert.deepEqual(await client.json('/receipts', Receipts), receipts);
  await error(
    await client.request(`/consent/${request.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'deny' }),
    }),
    409,
  );
});

test('one browser cannot access another session draft, answer its consent or reuse its session grant', async () => {
  const { app } = createHarness();
  const first = browser(app);
  const second = browser(app);
  const draft = await first.json('/wizards/booking', WizardDraftSchema, 'POST', {});
  const request = await first.json(
    '/consent',
    ConsentRequestSchema,
    'POST',
    consentBody(['postcode']),
  );
  await first.json(`/consent/${request.id}`, ConsentReply, 'POST', { decision: 'session' });
  await error(
    await second.request(`/wizards/${draft.id}`, {
      headers: { 'x-session-id': request.sessionId },
    }),
    404,
  );
  await error(
    await second.request(`/wizards/${draft.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { need: 'stolen' } }),
    }),
    404,
  );
  await error(await second.request(`/wizards/${draft.id}/submit`, { method: 'POST' }), 404);
  await error(
    await second.request(`/consent/${request.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'session' }),
    }),
    404,
  );
  await error(
    await second.request('/providers/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ service: 'gp', postcode: '3053', language: null }),
    }),
    403,
  );
  assert.ok(
    !(await second.json('/schedule', ScheduleSchema)).drafts.some((item) => item.id === draft.id),
  );
  assert.notEqual(first.cookie, second.cookie);
});

test('provider discovery requires permission for profile filters and has a remote fallback', async () => {
  const { app } = createHarness();
  const client = browser(app);
  for (const search of [
    { service: 'gp', postcode: '3053', language: null },
    { service: 'gp', postcode: null, language: 'zh-CN' },
    { service: 'mental_health', postcode: null, language: null },
  ]) {
    await error(
      await client.request('/providers/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(search),
      }),
      403,
    );
  }
  const remote = await client.json('/providers/search', ProviderSearchResultSchema, 'POST', {
    service: 'gp',
    postcode: null,
    language: null,
    telehealthOnly: false,
  });
  assert.ok(remote.providers.length > 0);
  assert.ok(remote.providers.every((provider) => provider.telehealth));
  for (const field of ['postcode', 'preferredLanguage']) {
    await client.json('/profile/permissions', ProfileResponseSchema, 'PATCH', {
      field,
      permission: 'session',
    });
  }
  const local = await client.json('/providers/search', ProviderSearchResultSchema, 'POST', {
    service: 'gp',
    postcode: '3053',
    language: 'zh-CN',
    telehealthOnly: false,
  });
  assert.ok(local.providers.some((provider) => !provider.telehealth));
  const explicitRemote = await client.json(
    '/providers/search',
    ProviderSearchResultSchema,
    'POST',
    {
      service: 'gp',
      postcode: '3053',
      language: 'zh-CN',
      telehealthOnly: true,
    },
  );
  assert.ok(explicitRemote.providers.every((provider) => provider.telehealth));
});

test('manually entered draft filters work after refusing stored data without granting Profile access', async () => {
  const { app } = createHarness();
  const client = browser(app);
  const draft = await client.json('/wizards/booking', WizardDraftSchema, 'POST', {
    prefill: { postcode: '3000', language: 'en' },
  });
  const search = { service: 'gp', postcode: '3000', language: 'en', telehealthOnly: false };
  const manual = await client.json('/providers/search', ProviderSearchResultSchema, 'POST', search);
  assert.ok(manual.providers.some((provider) => !provider.telehealth));
  const profile = await client.json('/profile', ProfileResponseSchema);
  assert.equal(profile.member.fields.postcode.permission, 'off');
  assert.equal(profile.member.fields.preferredLanguage.permission, 'off');
  assert.equal(profile.member.fields.postcode.value, '3053');
  await error(
    await client.request('/providers/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...search, postcode: '3053' }),
    }),
    403,
  );
  const other = browser(app);
  await error(
    await other.request('/providers/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(search),
    }),
    403,
  );
  assert.ok((await client.request(`/wizards/${draft.id}`, { method: 'DELETE' })).ok);
  await error(
    await client.request('/providers/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(search),
    }),
    403,
  );
});

test('an inline grant hydrates the existing draft while preserving its step and manual values', async () => {
  const { app } = createHarness();
  const client = browser(app);
  const draft = await client.json('/wizards/booking', WizardDraftSchema, 'POST', {
    prefill: { need: 'General consultation', language: 'en' },
  });
  assert.ok(draft.fields.postcode?.value == null);
  const request = await client.json(
    '/consent',
    ConsentRequestSchema,
    'POST',
    consentBody(['postcode', 'preferredLanguage']),
  );
  await client.json(`/consent/${request.id}`, ConsentReply, 'POST', { decision: 'session' });
  const hydrated = await client.json(`/wizards/${draft.id}`, WizardDraftSchema);
  assert.equal(hydrated.step, draft.step);
  assert.equal(hydrated.fields.postcode?.value, '3053');
  assert.equal(hydrated.fields.postcode?.source, 'profile');
  assert.equal(hydrated.fields.postcode?.confirmed, false);
  assert.equal(hydrated.fields.language?.value, 'en');
  assert.equal(hydrated.fields.language?.source, 'user');
});

test('revoking location invalidates an already-reviewed selection and the user can review again', async () => {
  const { app } = createHarness();
  const client = browser(app);
  await client.json('/profile/permissions', ProfileResponseSchema, 'PATCH', {
    field: 'postcode',
    permission: 'session',
  });
  const draft = await readyDraft(client);
  await client.json('/profile/permissions', ProfileResponseSchema, 'PATCH', {
    field: 'postcode',
    permission: 'off',
  });
  const revoked = await client.json(`/wizards/${draft.id}`, WizardDraftSchema);
  assert.ok(revoked.fields.postcode?.value == null);
  assert.ok(revoked.fields.providerId?.value == null);
  assert.ok(revoked.fields.slotId?.value == null);
  await error(await client.request(`/wizards/${draft.id}/submit`, { method: 'POST' }), 400);
  await client.json(`/wizards/${draft.id}`, WizardDraftSchema, 'PATCH', { step: 3 });
  const remote = await client.json('/providers/search', ProviderSearchResultSchema, 'POST', {
    service: 'gp',
    postcode: null,
    language: null,
    telehealthOnly: false,
  });
  const provider = remote.providers[0];
  assert.ok(provider?.slots[0]);
  await client.json(`/wizards/${draft.id}`, WizardDraftSchema, 'PATCH', {
    fields: { providerId: provider.id, slotId: provider.slots[0].id },
  });
  await client.json(`/wizards/${draft.id}`, WizardDraftSchema, 'PATCH', { step: 4 });
  await client.json(`/wizards/${draft.id}`, WizardDraftSchema, 'PATCH', { step: 5 });
  const result = await client.json(`/wizards/${draft.id}/submit`, Submit, 'POST');
  assert.equal(result.booking.status, 'confirmed');
});

test('expired sessions lose session grants and drafts while always permission and receipt history remain', async () => {
  let instant = CLOCK.getTime();
  const store = createDemoStore(() => new Date(instant));
  const client = browser(createApp(store));
  await client.json('/profile/permissions', ProfileResponseSchema, 'PATCH', {
    field: 'postcode',
    permission: 'session',
  });
  await client.json('/profile/permissions', ProfileResponseSchema, 'PATCH', {
    field: 'preferredLanguage',
    permission: 'always',
  });
  const draft = await client.json('/wizards/booking', WizardDraftSchema, 'POST', {
    prefill: { need: 'Private draft text' },
  });
  const pending = await client.json(
    '/consent',
    ConsentRequestSchema,
    'POST',
    consentBody(['interpreter']),
  );
  const oldCookie = client.cookie;
  instant += 31 * 60 * 1000;
  const after = await client.json('/profile', ProfileResponseSchema);
  assert.notEqual(client.cookie, oldCookie);
  assert.equal(after.member.fields.postcode.permission, 'off');
  assert.equal(after.member.fields.preferredLanguage.permission, 'always');
  assert.equal((await client.json('/schedule', ScheduleSchema)).drafts.length, 0);
  await error(await client.request(`/wizards/${draft.id}`), 404);
  await error(
    await client.request(`/consent/${pending.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'session' }),
    }),
    404,
  );
  const receipts = await client.json('/receipts', Receipts);
  assert.ok(
    receipts.some((receipt) => receipt.fields.includes('postcode') && receipt.status === 'revoked'),
  );
  assert.ok(
    receipts.some(
      (receipt) => receipt.fields.includes('preferredLanguage') && receipt.status === 'active',
    ),
  );
  assert.equal(store.consentWaiters.size, 0);
});

test('the manual five-step flow creates one booking, notes and reminders, with idempotent submit and cancel', async () => {
  const { app } = createHarness();
  const client = browser(app);
  const empty = await client.json('/wizards/booking', WizardDraftSchema, 'POST', {});
  await error(
    await client.request(`/wizards/${empty.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ step: 5 }),
    }),
    400,
  );
  await error(await client.request(`/wizards/${empty.id}/submit`, { method: 'POST' }), 400);
  const draft = await readyDraft(client);
  const result = await client.json(`/wizards/${draft.id}/submit`, Submit, 'POST');
  assert.equal(result.booking.status, 'confirmed');
  assert.equal(result.receipt.kind, 'action');
  assert.equal(result.receipt.bookingId, result.booking.id);
  assert.deepEqual(await client.json(`/wizards/${draft.id}/submit`, Submit, 'POST'), result);
  const booked = await client.json('/schedule', ScheduleSchema);
  assert.equal(booked.bookings.length, 1);
  assert.ok(booked.reminders.some((item) => item.bookingId === result.booking.id && item.enabled));
  assert.ok(booked.notes.some((item) => item.bookingId === result.booking.id));
  const added = await client.json('/reminders', ScheduleSchema, 'POST', {
    bookingId: result.booking.id,
    text: 'Bring member card',
    at: '2030-06-03T00:20:00Z',
  });
  const reminder = added.reminders.find((item) => item.text === 'Bring member card');
  assert.ok(reminder);
  const disabled = await client.json(`/reminders/${reminder.id}`, ScheduleSchema, 'PATCH', {
    enabled: false,
  });
  assert.equal(disabled.reminders.find((item) => item.id === reminder.id)?.enabled, false);
  const noted = await client.json('/notes', ScheduleSchema, 'POST', {
    bookingId: null,
    text: 'A personal reminder',
  });
  assert.ok(
    noted.notes.some((item) => item.text === 'A personal reminder' && item.createdBy === 'user'),
  );
  await error(await client.request(`/receipts/${result.receipt.id}`, { method: 'DELETE' }), 409);
  const cancelled = await client.json(
    `/bookings/${result.booking.id}/cancel`,
    ScheduleSchema,
    'POST',
  );
  assert.equal(cancelled.bookings[0]?.status, 'cancelled');
  assert.ok(
    cancelled.reminders
      .filter((item) => item.bookingId === result.booking.id)
      .every((item) => !item.enabled),
  );
  const receipts = await client.json('/receipts', Receipts);
  await client.json(`/bookings/${result.booking.id}/cancel`, ScheduleSchema, 'POST');
  assert.deepEqual(await client.json('/receipts', Receipts), receipts);
  assert.ok(receipts.some((item) => item.id === result.receipt.id));
});

test('abandoning or failing a reschedule preserves the original until replacement submission succeeds', async () => {
  const { app } = createHarness();
  const client = browser(app);
  const originalDraft = await readyDraft(client);
  const original = await client.json(`/wizards/${originalDraft.id}/submit`, Submit, 'POST');
  const abandoned = await client.json('/wizards/booking', WizardDraftSchema, 'POST', {
    rescheduleOf: original.booking.id,
  });
  await error(await client.request(`/wizards/${abandoned.id}/submit`, { method: 'POST' }), 400);
  assert.equal((await client.json('/schedule', ScheduleSchema)).bookings[0]?.status, 'confirmed');
  const removed = await client.request(`/wizards/${abandoned.id}`, { method: 'DELETE' });
  assert.ok(removed.ok);
  assert.equal((await client.json('/schedule', ScheduleSchema)).bookings[0]?.status, 'confirmed');
  const replacement = await readyDraft(client, { rescheduleOf: original.booking.id });
  const booked = await client.json(`/wizards/${replacement.id}/submit`, Submit, 'POST');
  const schedule = await client.json('/schedule', ScheduleSchema);
  assert.equal(
    schedule.bookings.find((item) => item.id === original.booking.id)?.status,
    'cancelled',
  );
  assert.equal(
    schedule.bookings.find((item) => item.id === booked.booking.id)?.status,
    'confirmed',
  );
  assert.ok(
    schedule.reminders
      .filter((item) => item.bookingId === original.booking.id)
      .every((item) => !item.enabled),
  );
});

for (const decision of ['session', 'deny'] satisfies ConsentDecision[]) {
  test(
    `SSE continues the same request after ${decision} consent and prepares only a draft`,
    { timeout: 8000 },
    async (t) => {
      const { app, store } = createHarness();
      const client = browser(app);
      t.after(() => {
        for (const session of store.sessions.values()) session.activeChat?.abort();
      });
      const reader = await openChat(client);
      t.after(() => reader.cancel().catch(() => undefined));
      const received: ChatEvent[] = [];
      for await (const event of events(reader)) {
        received.push(event);
        if (event.type === 'consent_request') {
          const reply = await client.json(`/consent/${event.request.id}`, ConsentReply, 'POST', {
            decision,
          });
          assert.equal(reply.request.status, decision === 'deny' ? 'denied' : 'granted');
        }
      }
      assert.ok(received.some((event) => event.type === 'consent_request'));
      assert.ok(received.some((event) => event.type === 'consent_resolved'));
      const opened = received.find((event) => event.type === 'wizard_open');
      assert.ok(opened, JSON.stringify(received));
      assert.equal(opened.draft.step, 1);
      assert.equal(received.at(-1)?.type, 'done');
      assert.ok(!received.some((event) => event.type === 'error' || event.type === 'action_done'));
      assert.equal(store.consentWaiters.size, 0);
      const schedule = await client.json('/schedule', ScheduleSchema);
      assert.equal(schedule.bookings.length, 0);
      assert.equal(schedule.drafts.filter((draft) => draft.status === 'draft').length, 1);
      if (decision === 'deny') {
        assert.ok(opened.draft.fields.postcode?.value == null);
        const provider = await client.json(
          `/providers/${String(opened.draft.fields.providerId?.value)}`,
          ProviderSchema.nullable(),
        );
        assert.equal(provider?.telehealth, true);
      }
    },
  );
}

test(
  'disconnecting an SSE stream releases pending consent without creating a booking',
  { timeout: 5000 },
  async (t) => {
    const { app, store } = createHarness();
    const client = browser(app);
    t.after(() => {
      for (const session of store.sessions.values()) session.activeChat?.abort();
    });
    const reader = await openChat(client);
    t.after(() => reader.cancel().catch(() => undefined));
    let consentId = '';
    for await (const event of events(reader)) {
      if (event.type === 'consent_request') {
        consentId = event.request.id;
        await reader.cancel();
        break;
      }
    }
    assert.ok(consentId);
    for (let attempt = 0; attempt < 100 && store.consentWaiters.size > 0; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(store.consentWaiters.size, 0);
    const schedule = await client.json('/schedule', ScheduleSchema);
    assert.equal(schedule.bookings.length, 0);
    assert.equal(schedule.drafts.length, 0);
  },
);

test(
  'demo reset interrupts paused chat and restores fixtures, drafts, receipts and permissions',
  { timeout: 5000 },
  async (t) => {
    const { app, store } = createHarness();
    const client = browser(app);
    t.after(() => {
      for (const session of store.sessions.values()) session.activeChat?.abort();
    });
    await client.json('/profile', ProfileResponseSchema, 'PATCH', {
      fields: { name: 'Edited demo member' },
    });
    await client.json('/profile/permissions', ProfileResponseSchema, 'PATCH', {
      field: 'postcode',
      permission: 'always',
    });
    await client.json('/wizards/booking', WizardDraftSchema, 'POST', {});
    const reader = await openChat(client);
    t.after(() => reader.cancel().catch(() => undefined));
    for await (const event of events(reader)) {
      if (event.type === 'consent_request') {
        const reset = await client.request('/demo/reset', { method: 'POST' });
        assert.equal(reset.status, 204);
        break;
      }
    }
    await withDeadline(reader.cancel());
    assert.equal(store.consentWaiters.size, 0);
    assert.equal(store.consents.size, 0);
    const profile = await client.json('/profile', ProfileResponseSchema);
    assert.equal(profile.member.fields.name.value, 'Lin Zhao');
    assert.equal(profile.member.fields.postcode.permission, 'off');
    assert.deepEqual(await client.json('/receipts', Receipts), []);
    const schedule = await client.json('/schedule', ScheduleSchema);
    assert.equal(schedule.bookings.length, 0);
    assert.equal(schedule.drafts.length, 0);
    assert.ok(schedule.cards.length > 0);
  },
);
