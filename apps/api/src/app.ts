import { Hono, type Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { bodyLimit } from 'hono/body-limit';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import {
  CONTRACT_VERSION,
  HealthResponseSchema,
  ProfilePatchSchema,
  PermissionPatchSchema,
  ProviderSearchSchema,
  WizardPatchSchema,
  WizardFieldValueSchema,
  ConsentResponseSchema,
  ChatRequestSchema,
  ChatEventSchema,
  type ChatEvent,
  type ProviderSearch,
  type WizardFieldValue,
} from '@bupa/contracts';
import { createDemoStore } from './store.js';
import { DomainError, fail, canUse, type BackendContext } from './domain.js';
import { createSession, expireSessions, closeSession, SESSION_TTL } from './sessions.js';
import {
  requestConsent,
  resolveConsent,
  waitConsent,
  setPermission,
  revokeReceipt,
} from './permissions.js';
import {
  profileForSession,
  patchProfile,
  scheduleForSession,
  createReminder,
  toggleReminder,
  createNote,
  dismissCard,
} from './member.js';
import { findProviders, getCover } from './providers.js';
import {
  createDraft,
  getDraft,
  patchDraft,
  prefillDraft,
  submitDraft,
  abandonDraft,
  cancelBooking,
} from './booking.js';
import { runDemoAgent, type AgentTools } from './agent.js';
import { detectSafety } from './safety.js';

type AppEnv = { Variables: { backend: BackendContext } };
const COOKIE = 'bupa_session';
const DraftInput = z
  .object({
    prefill: z.record(z.string(), WizardFieldValueSchema).optional(),
    rescheduleOf: z.string().nullable().optional(),
  })
  .strict();
const ConsentInput = z
  .object({
    fields: z.array(z.string()).min(1).max(13),
    sensitive: z.boolean().optional(),
    wizardFieldId: z.string().nullable().optional(),
  })
  .passthrough();
const ReminderInput = z
  .object({
    bookingId: z.string().nullable(),
    text: z.string().trim().min(1).max(2000),
    at: z.iso.datetime({ offset: true }),
  })
  .strict();
const NoteInput = ReminderInput.omit({ at: true });
const ChatInput = ChatRequestSchema.extend({
  message: z.string().trim().min(1).max(4000),
  sessionId: z.string().min(1).max(200),
}).strict();

async function readJson<T>(c: Context<AppEnv>, schema: z.ZodType<T>): Promise<T> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return fail(400, 'INVALID_JSON', 'Request body must be valid JSON.');
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success)
    fail(
      400,
      'VALIDATION_ERROR',
      parsed.error.issues
        .map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`)
        .join('; '),
    );
  return parsed.data;
}

export function createApp(store = createDemoStore()) {
  const app = new Hono<AppEnv>();
  app.use(
    '*',
    bodyLimit({
      maxSize: 64 * 1024,
      onError: (c) =>
        c.json({ error: { code: 'BODY_TOO_LARGE', message: 'Request body exceeds 64 KiB.' } }, 413),
    }),
  );
  app.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    if (c.req.header('Sec-Fetch-Site') === 'cross-site' && !['GET', 'HEAD'].includes(c.req.method))
      fail(403, 'CROSS_SITE_REQUEST', 'Cross-site writes are not allowed.');
    expireSessions(store);
    const candidate = store.sessions.get(getCookie(c, COOKIE) ?? '');
    const session = candidate && candidate.status !== 'closed' ? candidate : createSession(store);
    session.expiresAt = store.clock().getTime() + SESSION_TTL;
    setCookie(c, COOKIE, session.id, {
      httpOnly: true,
      sameSite: 'Strict',
      path: '/',
      maxAge: SESSION_TTL / 1000,
    });
    c.set('backend', { store, session });
    await next();
  });

  app.get('/health', (c) =>
    c.json(
      HealthResponseSchema.parse({
        status: 'ok',
        service: 'my-bupa-agent-api',
        mode: 'demo',
        contractVersion: CONTRACT_VERSION,
      }),
    ),
  );
  app.get('/profile', (c) => c.json(profileForSession(c.get('backend'))));
  app.patch('/profile', async (c) =>
    c.json(patchProfile(c.get('backend'), await readJson(c, ProfilePatchSchema.strict()))),
  );
  app.patch('/profile/permissions', async (c) => {
    const patch = await readJson(c, PermissionPatchSchema.strict());
    const ctx = c.get('backend');
    setPermission(ctx, patch.field, patch.permission);
    return c.json(profileForSession(ctx));
  });
  app.get('/receipts', (c) => c.json(store.receipts));
  app.delete('/receipts/:id', (c) => c.json(revokeReceipt(c.get('backend'), c.req.param('id'))));
  app.get('/schedule', (c) => c.json(scheduleForSession(c.get('backend'))));
  app.get('/providers/:id', (c) =>
    c.json(store.providers.find((provider) => provider.id === c.req.param('id')) ?? null),
  );
  app.post('/providers/search', async (c) =>
    c.json(findProviders(c.get('backend'), await readJson(c, ProviderSearchSchema.strict()), true)),
  );
  app.get('/covers/:service', (c) =>
    c.json(store.profile.covers.find((cover) => cover.service === c.req.param('service')) ?? null),
  );

  app.post('/wizards/booking', async (c) =>
    c.json(createDraft(c.get('backend'), await readJson(c, DraftInput)), 201),
  );
  app.get('/wizards/:id', (c) => c.json(getDraft(c.get('backend'), c.req.param('id'))));
  app.patch('/wizards/:id', async (c) =>
    c.json(
      patchDraft(
        c.get('backend'),
        c.req.param('id'),
        await readJson(c, WizardPatchSchema.strict()),
      ),
    ),
  );
  app.post('/wizards/:id/submit', (c) => c.json(submitDraft(c.get('backend'), c.req.param('id'))));
  app.delete('/wizards/:id', (c) => {
    abandonDraft(c.get('backend'), c.req.param('id'));
    return c.body(null, 204);
  });
  app.post('/bookings/:id/cancel', (c) => {
    const ctx = c.get('backend');
    cancelBooking(ctx, c.req.param('id'));
    return c.json(scheduleForSession(ctx));
  });
  app.get('/reminders', (c) => c.json(store.schedule.reminders));
  app.post('/reminders', async (c) =>
    c.json(createReminder(c.get('backend'), await readJson(c, ReminderInput))),
  );
  app.patch('/reminders/:id', async (c) => {
    const input = await readJson(c, z.object({ enabled: z.boolean() }).strict());
    return c.json(toggleReminder(c.get('backend'), c.req.param('id'), input.enabled));
  });
  app.get('/notes', (c) => c.json(store.schedule.notes));
  app.post('/notes', async (c) =>
    c.json(createNote(c.get('backend'), await readJson(c, NoteInput))),
  );
  app.post('/cards/:id/dismiss', (c) => c.json(dismissCard(c.get('backend'), c.req.param('id'))));

  app.post('/consent', async (c) => {
    const input = await readJson(c, ConsentInput);
    return c.json(
      requestConsent(c.get('backend'), input.fields, {
        sensitive: input.sensitive,
        wizardFieldId: input.wizardFieldId,
      }),
      201,
    );
  });
  app.post('/consent/:id', async (c) => {
    const input = await readJson(c, ConsentResponseSchema.strict());
    return c.json({ request: resolveConsent(c.get('backend'), c.req.param('id'), input.decision) });
  });

  app.post('/chat', async (c) => {
    const input = await readJson(c, ChatInput);
    const ctx = c.get('backend');
    const safety = detectSafety(
      input.message,
      /[\u3400-\u9fff]/u.test(input.message) ? 'zh' : input.uiLocale,
    );
    if (safety) {
      ctx.session.activeChat?.abort();
      return streamSSE(c, async (stream) => {
        await stream.writeSSE({ data: JSON.stringify(safety), event: 'safety_alert' });
        await stream.writeSSE({ data: JSON.stringify({ type: 'done' }), event: 'done' });
      });
    }
    if (ctx.session.activeChat)
      fail(409, 'CHAT_BUSY', 'Resolve or stop the current chat before starting another.');
    if (input.openDraftId) getDraft(ctx, input.openDraftId);
    const controller = new AbortController();
    ctx.session.activeChat = controller;
    ctx.session.status = 'running';
    const chatConsents = new Set<string>();
    let lastSearch: {
      filters: ProviderSearch;
      postcodeValue: string;
      languageValue: string;
    } | null = null;
    const checkSearch = (fields: Record<string, WizardFieldValue>) => {
      if (!fields.providerId && !fields.slotId) return;
      if (!lastSearch)
        fail(409, 'SEARCH_REQUIRED', 'Refresh provider options before prefilling a selection.');
      const { filters, postcodeValue, languageValue } = lastSearch;
      if (
        (filters.postcode &&
          (!canUse(ctx, 'postcode') ||
            store.profile.member.fields.postcode.value !== postcodeValue)) ||
        (filters.language &&
          (!canUse(ctx, 'preferredLanguage') ||
            store.profile.member.fields.preferredLanguage.value !== languageValue))
      ) {
        fail(
          409,
          'STALE_RECOMMENDATION',
          'Permission or profile changed. Ask for fresh recommendations before continuing.',
        );
      }
    };
    const tools: AgentTools = {
      sessionId: ctx.session.id,
      isAllowed: (field) => canUse(ctx, field),
      wasDenied: (field) => ctx.session.denied.has(field),
      getPreferences: () => ({
        postcode: canUse(ctx, 'postcode') ? store.profile.member.fields.postcode.value : null,
        language: canUse(ctx, 'preferredLanguage')
          ? store.profile.member.fields.preferredLanguage.value
          : null,
        interpreter: canUse(ctx, 'interpreter')
          ? ['yes', 'true'].includes(store.profile.member.fields.interpreter.value)
          : null,
      }),
      getCover: (service) => getCover(ctx, service),
      requestConsent: (fields, options) => {
        const request = requestConsent(ctx, fields, options);
        chatConsents.add(request.id);
        return request;
      },
      waitConsent: async (requestId, signal) => {
        ctx.session.status = 'awaiting_consent';
        try {
          return await waitConsent(ctx, requestId, signal);
        } finally {
          if (!controller.signal.aborted) ctx.session.status = 'running';
        }
      },
      createDraft: (prefill) => {
        checkSearch(prefill);
        const draft = createDraft(ctx, {});
        try {
          return prefillDraft(ctx, draft.id, prefill).draft;
        } catch (error) {
          abandonDraft(ctx, draft.id);
          throw error;
        }
      },
      getDraft: (draftId) => getDraft(ctx, draftId),
      prefillDraft: (draftId, fields) => {
        checkSearch(fields);
        return prefillDraft(ctx, draftId, fields);
      },
      findProviders: (search) => {
        const result = findProviders(ctx, search);
        lastSearch = {
          filters: search,
          postcodeValue: store.profile.member.fields.postcode.value,
          languageValue: store.profile.member.fields.preferredLanguage.value,
        };
        return result;
      },
      receiptEvents: (consentId) =>
        store.receipts.filter((receipt) =>
          (store.consentReceipts.get(consentId) ?? []).includes(receipt.id),
        ),
      setActiveDraft: (draftId) => {
        ctx.session.activeDraftId = draftId;
      },
      getActiveDraft: () => ctx.session.activeDraftId,
    };
    return streamSSE(c, async (stream) => {
      stream.onAbort(() => controller.abort());
      const heartbeat = setInterval(() => {
        void stream.write(': keep-alive\n\n').catch(() => controller.abort());
      }, 15_000);
      heartbeat.unref();
      const emit = async (event: ChatEvent) => {
        if (controller.signal.aborted) throw new Error('Stream cancelled.');
        await stream.writeSSE({
          data: JSON.stringify(ChatEventSchema.parse(event)),
          event: event.type,
        });
      };
      try {
        await runDemoAgent({ ...input, sessionId: ctx.session.id }, tools, emit, controller.signal);
        await emit({ type: 'done' });
      } catch (error) {
        if (!controller.signal.aborted) {
          await emit({
            type: 'error',
            message:
              error instanceof DomainError
                ? error.message
                : 'The demo request could not be completed. Please retry.',
          });
          await emit({ type: 'done' });
        }
      } finally {
        clearInterval(heartbeat);
        controller.abort();
        for (const requestId of chatConsents) {
          if (store.consents.get(requestId)?.status === 'pending')
            resolveConsent(ctx, requestId, 'deny');
        }
        if (ctx.session.activeChat === controller) {
          ctx.session.activeChat = null;
          if (ctx.session.status !== 'closed') ctx.session.status = 'idle';
        }
      }
    });
  });

  app.post('/session/close', (c) => {
    closeSession(store, c.get('backend').session);
    deleteCookie(c, COOKIE, { path: '/' });
    return c.body(null, 204);
  });
  app.post('/demo/reset', (c) => {
    for (const session of store.sessions.values()) closeSession(store, session);
    Object.assign(store, createDemoStore(store.clock));
    deleteCookie(c, COOKIE, { path: '/' });
    return c.body(null, 204);
  });
  app.notFound((c) =>
    c.json({ error: { code: 'NOT_FOUND', message: 'Route or resource not found.' } }, 404),
  );
  app.onError((error, c) => {
    if (error instanceof DomainError)
      return c.json({ error: { code: error.code, message: error.message } }, error.status as 400);
    return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Unexpected server error.' } }, 500);
  });
  return app;
}
