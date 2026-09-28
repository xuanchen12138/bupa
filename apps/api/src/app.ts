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
  ConversationTurnRequestSchema,
  CreateConversationRequestSchema,
  ConversationStreamEventSchema,
  PersonalizationPatchSchema,
  DismissSuggestionRequestSchema,
  StartSuggestionRequestSchema,
  type ChatEvent,
  type ChatRequest,
  type SourceRef,
  type ConversationStreamEvent,
} from '@bupa/contracts';
import { createDemoStore, type DemoStore } from './store.js';
import { DomainError, fail, type BackendContext } from './domain.js';
import { createSession, expireSessions, closeSession, SESSION_TTL } from './sessions.js';
import { requestConsent, resolveConsent, setPermission, revokeReceipt } from './permissions.js';
import {
  profileForSession,
  patchProfile,
  scheduleForSession,
  createReminder,
  toggleReminder,
  createNote,
  dismissCard,
} from './member.js';
import { findProviders } from './providers.js';
import {
  createDraft,
  getDraft,
  patchDraft,
  submitDraft,
  abandonDraft,
  cancelBooking,
} from './booking.js';
import { detectSafety } from './safety.js';
import { Repository, type Turn } from './repository.js';
import { PersonalizationService } from './personalization.js';
import { executeChat } from './chat-execution.js';
import { ModelError, type LanguageModel } from './models.js';

type AppEnv = { Variables: { backend: BackendContext } };
const COOKIE = 'bupa_session';
const DraftInput = z
  .object({
    prefill: z.record(z.string(), WizardFieldValueSchema).optional(),
    rescheduleOf: z.string().nullable().optional(),
    conversationId: z.string().nullable().optional(),
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
const TurnInput = ConversationTurnRequestSchema.extend({
  message: z.string().trim().min(1).max(4000),
  clientMessageId: z.string().min(1).max(200),
}).strict();
const PageInput = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z.string().max(1000).optional(),
});
async function readJson<T>(c: Context<AppEnv>, schema: z.ZodType<T>): Promise<T> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return fail(400, 'INVALID_JSON', 'Request body must be valid JSON.');
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) fail(400, 'VALIDATION_ERROR', 'Request does not match the API contract.');
  return parsed.data;
}
export type AppOptions = {
  repository?: Repository;
  model?: LanguageModel | null;
  seedHistory?: boolean;
  maxInputChars?: number;
  /** Trusted server-side authentication adapter. Never use a client-provided memberId. */
  resolveOwner?: (request: Request) => string;
};

export function createApp(initialStore = createDemoStore(), options: AppOptions = {}) {
  const repo = options.repository ?? new Repository();
  const model = options.model ?? null;
  const health = new PersonalizationService(repo, model, options.maxInputChars);
  const existed = !!repo.db
    .prepare('SELECT owner_id FROM owners WHERE owner_id=?')
    .get(initialStore.ownerId);
  const restored = repo.loadOwner(
    initialStore.ownerId,
    initialStore.clock,
    options.seedHistory,
    model?.mode,
  );
  if (existed) Object.assign(initialStore, restored);
  else {
    initialStore.persistent = restored.persistent;
    repo.saveBusiness(initialStore);
  }
  const owners = new Map([[initialStore.ownerId, initialStore]]);
  const running = new Set<Promise<void>>();
  let stopping = false;
  const app = new Hono<AppEnv>();
  const interrupt = (store: DemoStore) => {
    health.stop(store.ownerId);
    repo.interruptOwner(store.ownerId);
    for (const session of store.sessions.values()) session.activeChat?.abort();
  };
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
    if (stopping) fail(503, 'SERVER_STOPPING', 'The server is stopping.');
    if (c.req.header('Sec-Fetch-Site') === 'cross-site' && !['GET', 'HEAD'].includes(c.req.method))
      fail(403, 'CROSS_SITE_REQUEST', 'Cross-site writes are not allowed.');
    const owner = options.resolveOwner?.(c.req.raw) ?? initialStore.ownerId;
    if (!owner || owner.length > 200)
      fail(401, 'UNAUTHENTICATED', 'An authenticated owner is required.');
    let store = owners.get(owner);
    if (!store) {
      store = repo.loadOwner(owner, initialStore.clock, options.seedHistory, model?.mode);
      owners.set(owner, store);
    }
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
    repo.saveBusiness(store);
  });
  app.get('/health', (c) =>
    c.json({
      ...HealthResponseSchema.parse({
        status: 'ok',
        service: 'my-bupa-agent-api',
        mode: 'demo',
        contractVersion: CONTRACT_VERSION,
      }),
      modelMode: model ? 'openai' : 'scripted',
      model: model?.name ?? null,
      dataMode: 'fictional',
      storage: repo.path === ':memory:' ? 'memory' : 'sqlite',
      features: { conversations: true, personalization: true },
    }),
  );
  app.get('/profile', (c) => c.json(profileForSession(c.get('backend'))));
  app.patch('/profile', async (c) => {
    const input = await readJson(c, ProfilePatchSchema.strict());
    const ctx = c.get('backend');
    return c.json(repo.atomic(ctx.store, () => patchProfile(ctx, input)));
  });
  app.patch('/profile/permissions', async (c) => {
    const input = await readJson(c, PermissionPatchSchema.strict());
    const ctx = c.get('backend');
    if (input.permission === 'off') interrupt(ctx.store);
    return c.json(
      repo.atomic(ctx.store, () => {
        setPermission(ctx, input.field, input.permission);
        return profileForSession(ctx);
      }),
    );
  });
  app.get('/receipts', (c) => c.json(c.get('backend').store.receipts));
  app.delete('/receipts/:id', (c) => {
    const ctx = c.get('backend');
    const receiptId = c.req.param('id');
    if (repo.settings(ctx.store.ownerId).receiptId === receiptId) {
      health.setEnabled(ctx, false);
      return c.json(ctx.store.receipts);
    }
    interrupt(ctx.store);
    return c.json(repo.atomic(ctx.store, () => revokeReceipt(ctx, receiptId)));
  });
  app.get('/schedule', (c) => c.json(scheduleForSession(c.get('backend'))));
  app.get('/providers/:id', (c) =>
    c.json(
      c.get('backend').store.providers.find((provider) => provider.id === c.req.param('id')) ??
        null,
    ),
  );
  app.post('/providers/search', async (c) =>
    c.json(findProviders(c.get('backend'), await readJson(c, ProviderSearchSchema.strict()), true)),
  );
  app.get('/covers/:service', (c) =>
    c.json(
      c
        .get('backend')
        .store.profile.covers.find((cover) => cover.service === c.req.param('service')) ?? null,
    ),
  );
  app.post('/wizards/booking', async (c) => {
    const input = await readJson(c, DraftInput);
    const ctx = c.get('backend');
    return c.json(
      repo.atomic(ctx.store, () => {
        const originalBooking = input.rescheduleOf
          ? ctx.store.schedule.bookings.find((item) => item.id === input.rescheduleOf)
          : null;
        const originalConversation = originalBooking
          ? ctx.store.submissions.get(originalBooking.draftId)?.conversationId
          : null;
        const conversationId = input.conversationId ?? originalConversation;
        const conversation = conversationId
          ? repo.conversation(ctx.store.ownerId, conversationId)
          : null;
        const draft = createDraft(ctx, {
          prefill: input.prefill,
          rescheduleOf: input.rescheduleOf,
        });
        if (conversation) {
          ctx.store.schedule.drafts.find((item) => item.id === draft.id)!.conversationId =
            conversation.id;
          repo.updateConversation(ctx.store.ownerId, { ...conversation, activeDraftId: draft.id });
          return getDraft(ctx, draft.id);
        }
        return draft;
      }),
      201,
    );
  });
  app.get('/wizards/:id', (c) => c.json(getDraft(c.get('backend'), c.req.param('id'))));
  app.patch('/wizards/:id', async (c) => {
    const input = await readJson(c, WizardPatchSchema.strict());
    const ctx = c.get('backend');
    return c.json(repo.atomic(ctx.store, () => patchDraft(ctx, c.req.param('id'), input)));
  });
  app.post('/wizards/:id/submit', (c) => {
    const ctx = c.get('backend');
    return c.json(
      repo.atomic(ctx.store, () => {
        const result = submitDraft(ctx, c.req.param('id'));
        health.bookingChanged(ctx.store, result.booking.id);
        return {
          ...result,
          conversationId: ctx.store.submissions.get(c.req.param('id'))?.conversationId ?? null,
        };
      }),
    );
  });
  app.delete('/wizards/:id', (c) => {
    const ctx = c.get('backend');
    repo.atomic(ctx.store, () => abandonDraft(ctx, c.req.param('id')));
    return c.body(null, 204);
  });
  app.post('/bookings/:id/cancel', (c) => {
    const ctx = c.get('backend');
    return c.json(
      repo.atomic(ctx.store, () => {
        cancelBooking(ctx, c.req.param('id'));
        health.bookingChanged(ctx.store, c.req.param('id'));
        return scheduleForSession(ctx);
      }),
    );
  });
  app.get('/reminders', (c) => c.json(c.get('backend').store.schedule.reminders));
  app.post('/reminders', async (c) => {
    const input = await readJson(c, ReminderInput);
    const ctx = c.get('backend');
    return c.json(repo.atomic(ctx.store, () => createReminder(ctx, input)));
  });
  app.patch('/reminders/:id', async (c) => {
    const input = await readJson(c, z.object({ enabled: z.boolean() }).strict());
    const ctx = c.get('backend');
    return c.json(
      repo.atomic(ctx.store, () => toggleReminder(ctx, c.req.param('id'), input.enabled)),
    );
  });
  app.get('/notes', (c) => c.json(c.get('backend').store.schedule.notes));
  app.post('/notes', async (c) => {
    const input = await readJson(c, NoteInput);
    const ctx = c.get('backend');
    return c.json(repo.atomic(ctx.store, () => createNote(ctx, input)));
  });
  app.post('/cards/:id/dismiss', (c) => {
    const ctx = c.get('backend');
    return c.json(repo.atomic(ctx.store, () => dismissCard(ctx, c.req.param('id'))));
  });
  app.post('/consent', async (c) => {
    const input = await readJson(c, ConsentInput);
    const ctx = c.get('backend');
    return c.json(
      repo.atomic(ctx.store, () =>
        requestConsent(ctx, input.fields, {
          sensitive: input.sensitive,
          wizardFieldId: input.wizardFieldId,
        }),
      ),
      201,
    );
  });
  app.post('/consent/:id', async (c) => {
    const input = await readJson(c, ConsentResponseSchema.strict());
    const ctx = c.get('backend');
    return c.json(
      repo.atomic(ctx.store, () => ({
        request: resolveConsent(ctx, c.req.param('id'), input.decision),
      })),
    );
  });

  function runStream(c: Context<AppEnv>, request: ChatRequest, turn: Turn | null, replay = false) {
    const ctx = c.get('backend');
    const { store } = ctx;
    const owner = store.ownerId;
    const controller = new AbortController();
    if (!replay) {
      ctx.session.activeChat = controller;
      ctx.session.status = 'running';
    }
    let settle!: () => void;
    const completion = new Promise<void>((resolve) => {
      settle = resolve;
    });
    running.add(completion);
    return streamSSE(c, async (stream) => {
      stream.onAbort(() => controller.abort());
      const heartbeat = setInterval(() => {
        void stream.write(': keep-alive\n\n').catch(() => controller.abort());
      }, 15000);
      heartbeat.unref();
      const wire = async (payload: ConversationStreamEvent['payload'], entryId: string | null) => {
        controller.signal.throwIfAborted();
        const event = turn
          ? ConversationStreamEventSchema.parse({
              conversationId: turn.conversationId,
              turnId: turn.id,
              eventIndex: repo.setTurnEventIndex(owner, turn),
              at: store.clock().toISOString(),
              entryId,
              payload,
            })
          : ChatEventSchema.parse(payload);
        await stream.writeSSE({ event: payload.type, data: JSON.stringify(event) });
      };
      const send = async (event: ChatEvent, refs: SourceRef[] = []) => {
        controller.signal.throwIfAborted();
        ChatEventSchema.parse(event);
        const entryId =
          turn && !replay
            ? repo.recordEvent(store, turn, event, refs, store.clock().toISOString())
            : event.type === 'message'
              ? event.id
              : null;
        await wire(event, entryId);
      };
      try {
        if (turn) {
          const user = repo.entry(owner, turn.conversationId, turn.userId);
          if (user.kind !== 'user') throw new Error('Invalid turn');
          await wire(
            {
              type: 'turn_accepted',
              userMessageId: user.id,
              clientMessageId: user.clientMessageId,
            },
            user.id,
          );
        }
        if (replay && turn) {
          for (const entry of repo.allEntries(owner, turn.conversationId))
            if (entry.turnId === turn.id && entry.kind === 'assistant')
              await wire(
                {
                  type: 'message',
                  id: entry.id,
                  text: entry.text,
                  translation: entry.translation,
                  suggestions: entry.suggestions,
                },
                entry.id,
              );
        } else
          await executeChat(
            ctx,
            request,
            model,
            health,
            turn?.conversationId ?? null,
            send,
            controller.signal,
            () => {
              if (turn) repo.assertRunning(owner, turn);
            },
          );
        controller.signal.throwIfAborted();
        if (turn && !replay) repo.finishTurn(owner, turn.id, 'completed');
        await wire({ type: 'done' }, null);
      } catch (error) {
        if (!controller.signal.aborted) {
          const message =
            error instanceof DomainError
              ? error.message
              : error instanceof ModelError
                ? 'Model request failed (' + error.code + '). Please retry.'
                : 'The request could not be completed. Please retry.';
          let entryId: string | null = null;
          if (turn && !replay) {
            try {
              entryId = repo.recordEvent(
                store,
                turn,
                { type: 'error', message },
                [],
                store.clock().toISOString(),
              );
            } catch {
              /* Stale or deleted turn must not recreate content. */
            }
            repo.finishTurn(owner, turn.id, 'failed');
          }
          try {
            await wire({ type: 'error', message }, entryId);
            await wire({ type: 'done' }, null);
          } catch {
            /* Deleted conversation or disconnected client. */
          }
        }
      } finally {
        clearInterval(heartbeat);
        controller.abort();
        if (turn && !replay) repo.finishTurn(owner, turn.id, 'interrupted');
        if (ctx.session.activeChat === controller) {
          ctx.session.activeChat = null;
          if (ctx.session.status !== 'closed') ctx.session.status = 'idle';
        }
        if (
          !stopping &&
          turn &&
          !replay &&
          repo.db.prepare('SELECT id FROM turns WHERE owner_id=? AND id=?').get(owner, turn.id)
        )
          health.refresh(store);
        running.delete(completion);
        settle();
      }
    });
  }
  const allowStart = (ctx: BackendContext, message: string) => {
    if (detectSafety(message, /[\u3400-\u9fff]/u.test(message) ? 'zh' : 'en')) {
      ctx.session.activeChat?.abort();
      repo.interruptOwner(ctx.store.ownerId);
    } else if (ctx.session.activeChat)
      fail(409, 'CHAT_BUSY', 'Resolve or stop the current chat before starting another.');
  };
  const checkDraft = (
    ctx: BackendContext,
    draftId: string | null,
    conversationId: string | null,
  ) => {
    if (draftId && (getDraft(ctx, draftId).conversationId ?? null) !== conversationId)
      fail(404, 'DRAFT_NOT_FOUND', 'Draft does not belong to this conversation.');
  };
  app.post('/chat', async (c) => {
    const input = await readJson(c, ChatInput);
    const ctx = c.get('backend');
    allowStart(ctx, input.message);
    checkDraft(ctx, input.openDraftId, null);
    return runStream(c, { ...input, sessionId: ctx.session.id }, null);
  });
  app.get('/conversations', (c) => {
    const page = PageInput.safeParse(c.req.query());
    if (!page.success) fail(400, 'INVALID_PAGE', 'Invalid pagination.');
    return c.json(repo.page(c.get('backend').store.ownerId, page.data.limit, page.data.cursor));
  });
  app.post('/conversations', async (c) => {
    const input = await readJson(
      c,
      CreateConversationRequestSchema.extend({ requestId: z.string().min(1).max(200) }).strict(),
    );
    const { store } = c.get('backend');
    return c.json(
      repo.createConversation(store.ownerId, input.requestId, store.clock().toISOString()),
      201,
    );
  });
  app.get('/conversations/:id', (c) =>
    c.json(repo.conversation(c.get('backend').store.ownerId, c.req.param('id'))),
  );
  app.get('/conversations/:id/messages', (c) => {
    const page = PageInput.safeParse(c.req.query());
    if (!page.success) fail(400, 'INVALID_PAGE', 'Invalid pagination.');
    return c.json(
      repo.messages(
        c.get('backend').store.ownerId,
        c.req.param('id'),
        page.data.limit,
        page.data.cursor,
      ),
    );
  });
  app.get('/conversations/:id/messages/:messageId', (c) =>
    c.json(repo.entry(c.get('backend').store.ownerId, c.req.param('id'), c.req.param('messageId'))),
  );
  app.delete('/conversations/:id', (c) => {
    const { store } = c.get('backend');
    if (
      !repo.db
        .prepare('SELECT id FROM conversations WHERE owner_id=? AND id=?')
        .get(store.ownerId, c.req.param('id'))
    )
      fail(404, 'CONVERSATION_NOT_FOUND', 'Conversation was not found.');
    interrupt(store);
    const result = repo.removeConversation(store, c.req.param('id'));
    health.refresh(store);
    return c.json(result);
  });
  app.post('/conversations/:id/messages', async (c) => {
    const input = await readJson(c, TurnInput);
    const ctx = c.get('backend');
    const conversationId = c.req.param('id');
    repo.conversation(ctx.store.ownerId, conversationId);
    checkDraft(ctx, input.openDraftId, conversationId);
    const refs = health.requestSources(ctx.store.ownerId, conversationId, input);
    allowStart(ctx, input.message);
    const started = repo.beginTurn(
      ctx.store.ownerId,
      conversationId,
      ctx.session.id,
      input,
      ctx.store.clock().toISOString(),
      refs,
    );
    if (started.replay && started.turn.status !== 'completed')
      fail(
        409,
        'TURN_INTERRUPTED',
        'Read saved messages; explicitly retry with a new clientMessageId.',
      );
    return runStream(c, { ...input, sessionId: ctx.session.id }, started.turn, started.replay);
  });
  app.post('/conversations/:id/turns/:turnId/cancel', (c) => {
    const { store } = c.get('backend');
    repo.conversation(store.ownerId, c.req.param('id'));
    const turn = repo.turn(store.ownerId, c.req.param('id'), c.req.param('turnId'));
    if (turn.status === 'running') {
      repo.finishTurn(store.ownerId, turn.id, 'interrupted');
      store.sessions.get(turn.sessionId)?.activeChat?.abort();
    }
    return c.json({
      turnId: turn.id,
      status: repo.turn(store.ownerId, turn.conversationId, turn.id).status,
    });
  });
  app.get('/personalization', (c) => c.json(repo.settings(c.get('backend').store.ownerId)));
  app.patch('/personalization', async (c) => {
    const input = await readJson(c, PersonalizationPatchSchema.strict());
    const ctx = c.get('backend');
    const settings = health.setEnabled(ctx, input.enabled);
    if (settings.enabled) health.refresh(ctx.store);
    return c.json(settings);
  });
  app.get('/health-overview', (c) => c.json(repo.overview(c.get('backend').store.ownerId)));
  app.post('/health-overview/refresh', (c) => c.json(health.refresh(c.get('backend').store), 202));
  app.post('/health-suggestions/:id/dismiss', async (c) => {
    const input = await readJson(c, DismissSuggestionRequestSchema.strict());
    return c.json(
      health.dismiss(
        c.get('backend').store.ownerId,
        c.req.param('id'),
        input.expectedSnapshotRevision,
      ),
    );
  });
  app.post('/health-suggestions/:id/start', async (c) => {
    const input = await readJson(
      c,
      StartSuggestionRequestSchema.extend({ requestId: z.string().min(1).max(200) }).strict(),
    );
    return c.json(health.start(c.get('backend').store, c.req.param('id'), input));
  });
  app.post('/session/close', (c) => {
    const ctx = c.get('backend');
    closeSession(ctx.store, ctx.session);
    deleteCookie(c, COOKIE, { path: '/' });
    return c.body(null, 204);
  });
  app.post('/demo/reset', (c) => {
    const { store } = c.get('backend');
    interrupt(store);
    for (const session of store.sessions.values()) closeSession(store, session);
    repo.transaction(() => {
      for (const table of [
        'source_edges',
        'entries',
        'turns',
        'conversations',
        'suggestion_state',
        'commands',
        'generation_jobs',
        'owners',
      ])
        repo.db.prepare('DELETE FROM ' + table + ' WHERE owner_id=?').run(store.ownerId);
      Object.assign(
        store,
        repo.loadOwner(store.ownerId, store.clock, options.seedHistory, model?.mode),
      );
    });
    deleteCookie(c, COOKIE, { path: '/' });
    return c.body(null, 204);
  });
  app.notFound((c) =>
    c.json(
      { error: { code: 'NOT_FOUND', message: 'Route or resource not found.', retryable: false } },
      404,
    ),
  );
  app.onError((error, c) =>
    error instanceof DomainError
      ? c.json(
          { error: { code: error.code, message: error.message, retryable: false } },
          error.status as 400,
        )
      : c.json(
          {
            error: {
              code: 'INTERNAL_ERROR',
              message: 'Unexpected server error.',
              retryable: false,
            },
          },
          500,
        ),
  );
  return Object.assign(app, {
    async shutdown() {
      stopping = true;
      const jobs = [...owners.keys()].map((owner) => health.idle(owner));
      for (const store of owners.values()) {
        interrupt(store);
        for (const session of store.sessions.values()) closeSession(store, session);
        repo.saveBusiness(store);
      }
      await Promise.allSettled([...running, ...jobs]);
      repo.close();
    },
  });
}
