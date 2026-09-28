import { z } from 'zod';
import {
  BookingSchema,
  CancelTurnResponseSchema,
  ChatEventSchema,
  ConsentRequestSchema,
  ConversationEntrySchema,
  ConversationListResponseSchema,
  ConversationMessagesResponseSchema,
  ConversationSchema,
  ConversationStreamEventSchema,
  DeleteConversationResponseSchema,
  HealthOverviewRefreshResponseSchema,
  HealthOverviewResponseSchema,
  HealthResponseSchema,
  PersonalizationSettingsSchema,
  ProfileResponseSchema,
  ProviderSchema,
  ProviderSearchResultSchema,
  ReceiptSchema,
  ScheduleSchema,
  StartSuggestionResponseSchema,
  WizardDraftSchema,
  type CancelTurnResponse,
  type ChatEvent,
  type ChatRequest,
  type ConsentDecision,
  type ConsentRequest,
  type Conversation,
  type ConversationEntry,
  type ConversationListResponse,
  type ConversationMessagesResponse,
  type ConversationStreamEvent,
  type ConversationTurnRequest,
  type DeleteConversationResponse,
  type DismissSuggestionRequest,
  type HealthOverviewRefreshResponse,
  type HealthOverviewResponse,
  type PermissionPatch,
  type PersonalizationPatch,
  type PersonalizationSettings,
  type ProfilePatch,
  type ProviderSearch,
  type StartSuggestionRequest,
  type StartSuggestionResponse,
  type WizardFieldValue,
  type WizardPatch,
} from '@bupa/contracts';
import { mockService } from '@/mock/service';
import type { PersistenceStatus } from '@/mock/persistence';
import { ApiError } from './errors';

/**
 * One API surface, two adapters.
 * - `mock` (default): the in-browser MockService, so the whole demo path runs without a backend.
 *   History, overview and bookings persist in this browser's IndexedDB.
 * - `http`: apps/api over `/api/*`. The 0.2.0 booking/chat routes exist there today; the 0.3.0
 *   history and personalisation routes do not yet, so `features` says so and the UI shows it
 *   instead of quietly falling back to the mock.
 * Switch with VITE_API_MODE=http.
 */
export type ApiMode = 'mock' | 'http';
export const apiMode: ApiMode = import.meta.env.VITE_API_MODE === 'http' ? 'http' : 'mock';

type Health = z.infer<typeof HealthResponseSchema>;
export type Locale = 'en' | 'zh';

export interface ApiFeatures {
  /** Persisted multi-conversation history and the conversation turn stream. */
  conversations: boolean;
  /** Health overview, suggestions and the personalisation setting. */
  personalization: boolean;
  /** Where the data lives, for the UI to say so. */
  storage: 'browser' | 'server';
}

export interface Api {
  features: ApiFeatures;
  health(): Promise<Health>;
  profile(): Promise<z.infer<typeof ProfileResponseSchema>>;
  patchProfile(patch: ProfilePatch): Promise<z.infer<typeof ProfileResponseSchema>>;
  setPermission(patch: PermissionPatch): Promise<z.infer<typeof ProfileResponseSchema>>;
  receipts(): Promise<z.infer<typeof ReceiptSchema>[]>;
  revokeReceipt(id: string): Promise<z.infer<typeof ReceiptSchema>[]>;
  schedule(): Promise<z.infer<typeof ScheduleSchema>>;
  cancelBooking(id: string): Promise<z.infer<typeof ScheduleSchema>>;
  createReminder(input: {
    bookingId: string | null;
    text: string;
    at: string;
  }): Promise<z.infer<typeof ScheduleSchema>>;
  toggleReminder(id: string, enabled: boolean): Promise<z.infer<typeof ScheduleSchema>>;
  createNote(input: {
    bookingId: string | null;
    text: string;
  }): Promise<z.infer<typeof ScheduleSchema>>;
  dismissCard(id: string): Promise<z.infer<typeof ScheduleSchema>>;
  provider(id: string): Promise<z.infer<typeof ProviderSchema> | null>;
  findProviders(search: ProviderSearch): Promise<z.infer<typeof ProviderSearchResultSchema>>;
  createDraft(input?: {
    prefill?: Record<string, WizardFieldValue>;
    rescheduleOf?: string | null;
  }): Promise<z.infer<typeof WizardDraftSchema>>;
  getDraft(id: string): Promise<z.infer<typeof WizardDraftSchema>>;
  patchDraft(id: string, patch: WizardPatch): Promise<z.infer<typeof WizardDraftSchema>>;
  submitDraft(id: string): Promise<{
    booking: z.infer<typeof BookingSchema>;
    receipt: z.infer<typeof ReceiptSchema>;
    /** Conversation the draft belonged to, when the server knows it. */
    conversationId?: string | null;
  }>;
  abandonDraft(id: string): Promise<void>;
  requestConsent(
    input: Omit<ConsentRequest, 'id' | 'sessionId' | 'status'>,
  ): Promise<ConsentRequest>;
  respondConsent(id: string, decision: ConsentDecision): Promise<{ request: ConsentRequest }>;
  /** Legacy single-session chat (0.2.0). Used only when `features.conversations` is false. */
  chat(
    request: ChatRequest,
    onEvent: (event: ChatEvent) => void,
    signal?: AbortSignal,
  ): Promise<void>;

  /* 0.3.0 — conversations */
  conversations(): Promise<ConversationListResponse>;
  createConversation(input: { requestId: string }): Promise<Conversation>;
  conversationMessages(id: string): Promise<ConversationMessagesResponse>;
  conversationEntry(id: string, messageId: string): Promise<ConversationEntry>;
  deleteConversation(id: string): Promise<DeleteConversationResponse>;
  sendTurn(
    conversationId: string,
    request: ConversationTurnRequest,
    onEvent: (event: ConversationStreamEvent) => void,
    signal?: AbortSignal,
  ): Promise<void>;
  cancelTurn(conversationId: string, turnId: string): Promise<CancelTurnResponse>;

  /* 0.3.0 — personalisation */
  personalization(): Promise<PersonalizationSettings>;
  setPersonalization(patch: PersonalizationPatch): Promise<PersonalizationSettings>;
  healthOverview(): Promise<HealthOverviewResponse>;
  refreshHealthOverview(): Promise<HealthOverviewRefreshResponse>;
  dismissSuggestion(id: string, body: DismissSuggestionRequest): Promise<HealthOverviewResponse>;
  startSuggestion(id: string, body: StartSuggestionRequest): Promise<StartSuggestionResponse>;

  reset(options?: { locale?: Locale }): Promise<void>;
  /** Receipts, notes and reminders are written in this language. */
  setLocale(locale: Locale): void;
  /** Fires whenever server-side state changed outside a request the caller made (mock only). */
  subscribe(listener: () => void): () => void;
  /** Local persistence health (mock only; the server keeps its own state). */
  persistence: {
    status(): PersistenceStatus;
    onChange(listener: (status: PersistenceStatus) => void): () => void;
    retry(): Promise<void>;
    /** Resolves once the mock has loaded or seeded its snapshot. */
    ready(): Promise<void>;
    initError(): { kind: 'corrupt' | 'unavailable'; message: string } | null;
  };
}

/* ----------------------------------------------------------------- mock */
const mockApi: Api = {
  features: { conversations: true, personalization: true, storage: 'browser' },
  health: () => mockService.health(),
  profile: () => mockService.profile(),
  patchProfile: (patch) => mockService.patchProfile(patch),
  setPermission: (patch) => mockService.setPermission(patch),
  receipts: () => mockService.receipts(),
  revokeReceipt: (id) => mockService.revokeReceipt(id),
  schedule: () => mockService.schedule(),
  cancelBooking: (id) => mockService.cancelBooking(id),
  createReminder: (input) => mockService.createReminder(input),
  toggleReminder: (id, enabled) => mockService.toggleReminder(id, enabled),
  createNote: (input) => mockService.createNote(input),
  dismissCard: (id) => mockService.dismissCard(id),
  provider: (id) => mockService.provider(id),
  findProviders: (search) => mockService.findProviders(search),
  createDraft: (input) => mockService.createDraft(input),
  getDraft: (id) => mockService.getDraft(id),
  patchDraft: (id, patch) => mockService.patchDraft(id, patch),
  submitDraft: (id) => mockService.submitDraft(id),
  abandonDraft: (id) => mockService.abandonDraft(id),
  requestConsent: (input) => mockService.requestConsent(input),
  respondConsent: (id, decision) => mockService.respondConsent(id, decision),
  chat: () =>
    Promise.reject(
      new ApiError('UNSUPPORTED', 'The mock only speaks the conversation protocol.', {
        status: 501,
      }),
    ),
  conversations: () => mockService.conversations(),
  createConversation: (input) => mockService.createConversation(input),
  conversationMessages: (id) => mockService.conversationMessages(id),
  conversationEntry: (id, messageId) => mockService.conversationEntry(id, messageId),
  deleteConversation: (id) => mockService.deleteConversation(id),
  sendTurn: (id, request, onEvent, signal) => mockService.sendTurn(id, request, onEvent, signal),
  cancelTurn: (id, turnId) => mockService.cancelTurn(id, turnId),
  personalization: () => mockService.personalization(),
  setPersonalization: (patch) => mockService.setPersonalization(patch),
  healthOverview: () => mockService.healthOverview(),
  refreshHealthOverview: () => mockService.refreshHealthOverview(),
  dismissSuggestion: (id, body) => mockService.dismissSuggestion(id, body),
  startSuggestion: (id, body) => mockService.startSuggestion(id, body),
  reset: (options) => mockService.reset(options),
  setLocale: (locale) => mockService.setLocale(locale),
  subscribe: (listener) => mockService.subscribe(listener),
  persistence: {
    status: () => mockService.status,
    onChange: (listener) => mockService.onPersistence(listener),
    retry: () => mockService.retryPersist(),
    ready: () => mockService.ready(),
    initError: () => mockService.initError,
  },
};

/* ----------------------------------------------------------------- http */
async function request<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!response.ok) {
    let code = `HTTP_${response.status}`;
    let message = `Request failed (${response.status})`;
    let retryable = false;
    try {
      const body = (await response.json()) as {
        error?: { code?: string; message?: string; retryable?: boolean };
      };
      code = body.error?.code ?? code;
      message = body.error?.message ?? message;
      retryable = body.error?.retryable ?? false;
    } catch {
      // keep the defaults
    }
    throw new ApiError(code, message, { status: response.status, retryable });
  }
  if (response.status === 204) return undefined as T;
  return schema.parse(await response.json());
}
const json = (body: unknown, method = 'POST'): RequestInit => ({
  method,
  body: JSON.stringify(body),
});
const ReceiptsSchema = z.array(ReceiptSchema);
const SubmitSchema = z.object({
  booking: BookingSchema,
  receipt: ReceiptSchema,
  conversationId: z.string().nullable().optional(),
});
const ConsentReplySchema = z.object({ request: ConsentRequestSchema });

/**
 * Reads a `text/event-stream` body and hands every complete `data:` frame to `onFrame`.
 * Handles CRLF, keep-alive comments, chunks that split a frame, and a trailing frame with no
 * final blank line. A frame that is not valid JSON is skipped rather than ending the stream.
 */
async function readEventStream(body: ReadableStream<Uint8Array>, onFrame: (data: unknown) => void) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const flush = (chunk: string) => {
    const data = chunk
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .join('\n');
    if (!data) return;
    try {
      onFrame(JSON.parse(data));
    } catch {
      // Malformed frame: ignore it, keep the stream alive.
    }
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let index: number;
    while ((index = buffer.search(/\r?\n\r?\n/)) >= 0) {
      const match = /\r?\n\r?\n/.exec(buffer.slice(index));
      const chunk = buffer.slice(0, index);
      buffer = buffer.slice(index + (match?.[0].length ?? 2));
      flush(chunk);
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) flush(buffer);
}

async function streamChat(
  body: ChatRequest,
  onEvent: (event: ChatEvent) => void,
  signal?: AbortSignal,
) {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok || !response.body)
    throw new ApiError(`HTTP_${response.status}`, `Chat request failed (${response.status})`, {
      status: response.status,
    });
  await readEventStream(response.body, (data) => {
    const parsed = ChatEventSchema.safeParse(data);
    if (parsed.success) onEvent(parsed.data);
  });
}

async function streamTurn(
  conversationId: string,
  body: ConversationTurnRequest,
  onEvent: (event: ConversationStreamEvent) => void,
  signal?: AbortSignal,
) {
  const response = await fetch(`/api/conversations/${conversationId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok || !response.body) {
    let code = `HTTP_${response.status}`;
    let message = `Chat request failed (${response.status})`;
    try {
      const error = (await response.json()) as { error?: { code?: string; message?: string } };
      code = error.error?.code ?? code;
      message = error.error?.message ?? message;
    } catch {
      // keep defaults
    }
    throw new ApiError(code, message, { status: response.status });
  }
  const seen = new Set<number>();
  await readEventStream(response.body, (data) => {
    const parsed = ConversationStreamEventSchema.safeParse(data);
    if (!parsed.success) return;
    if (parsed.data.turnId && seen.has(parsed.data.eventIndex)) return;
    seen.add(parsed.data.eventIndex);
    onEvent(parsed.data);
  });
}

const httpApi: Api = {
  // Flip these to true once apps/api ships the 0.3.0 routes (docs/backend-personalization-status.md).
  features: { conversations: false, personalization: false, storage: 'server' },
  health: () => request('/health', HealthResponseSchema),
  profile: () => request('/profile', ProfileResponseSchema),
  patchProfile: (patch) => request('/profile', ProfileResponseSchema, json(patch, 'PATCH')),
  setPermission: (patch) =>
    request('/profile/permissions', ProfileResponseSchema, json(patch, 'PATCH')),
  receipts: () => request('/receipts', ReceiptsSchema),
  revokeReceipt: (id) => request(`/receipts/${id}`, ReceiptsSchema, { method: 'DELETE' }),
  schedule: () => request('/schedule', ScheduleSchema),
  cancelBooking: (id) => request(`/bookings/${id}/cancel`, ScheduleSchema, { method: 'POST' }),
  createReminder: (input) => request('/reminders', ScheduleSchema, json(input)),
  toggleReminder: (id, enabled) =>
    request(`/reminders/${id}`, ScheduleSchema, json({ enabled }, 'PATCH')),
  createNote: (input) => request('/notes', ScheduleSchema, json(input)),
  dismissCard: (id) => request(`/cards/${id}/dismiss`, ScheduleSchema, { method: 'POST' }),
  provider: (id) => request(`/providers/${id}`, ProviderSchema.nullable()),
  findProviders: (search) => request('/providers/search', ProviderSearchResultSchema, json(search)),
  createDraft: (input) => request('/wizards/booking', WizardDraftSchema, json(input ?? {})),
  getDraft: (id) => request(`/wizards/${id}`, WizardDraftSchema),
  patchDraft: (id, patch) => request(`/wizards/${id}`, WizardDraftSchema, json(patch, 'PATCH')),
  submitDraft: (id) => request(`/wizards/${id}/submit`, SubmitSchema, { method: 'POST' }),
  abandonDraft: (id) =>
    request(`/wizards/${id}`, z.unknown(), { method: 'DELETE' }).then(() => undefined),
  requestConsent: (input) => request('/consent', ConsentRequestSchema, json(input)),
  respondConsent: (id, decision) =>
    request(`/consent/${id}`, ConsentReplySchema, json({ decision })),
  chat: streamChat,
  conversations: () => request('/conversations', ConversationListResponseSchema),
  createConversation: (input) => request('/conversations', ConversationSchema, json(input)),
  conversationMessages: (id) =>
    request(`/conversations/${id}/messages`, ConversationMessagesResponseSchema),
  conversationEntry: (id, messageId) =>
    request(`/conversations/${id}/messages/${messageId}`, ConversationEntrySchema),
  deleteConversation: (id) =>
    request(`/conversations/${id}`, DeleteConversationResponseSchema, { method: 'DELETE' }),
  sendTurn: streamTurn,
  cancelTurn: (id, turnId) =>
    request(`/conversations/${id}/turns/${turnId}/cancel`, CancelTurnResponseSchema, {
      method: 'POST',
    }),
  personalization: () => request('/personalization', PersonalizationSettingsSchema),
  setPersonalization: (patch) =>
    request('/personalization', PersonalizationSettingsSchema, json(patch, 'PATCH')),
  healthOverview: () => request('/health-overview', HealthOverviewResponseSchema),
  refreshHealthOverview: () =>
    request('/health-overview/refresh', HealthOverviewRefreshResponseSchema, { method: 'POST' }),
  dismissSuggestion: (id, body) =>
    request(`/health-suggestions/${id}/dismiss`, HealthOverviewResponseSchema, json(body)),
  startSuggestion: (id, body) =>
    request(`/health-suggestions/${id}/start`, StartSuggestionResponseSchema, json(body)),
  reset: () => request('/demo/reset', z.unknown(), { method: 'POST' }).then(() => undefined),
  setLocale: () => undefined,
  subscribe: () => () => undefined,
  persistence: {
    status: () => ({ state: 'ready', savedAt: null, store: 'memory' }),
    onChange: () => () => undefined,
    retry: () => Promise.resolve(),
    ready: () => Promise.resolve(),
    initError: () => null,
  },
};

export const api: Api = apiMode === 'http' ? httpApi : mockApi;
export { ApiError, ValidationError, isApiError } from './errors';
