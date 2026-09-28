import type { Conversation, ConversationEntry, SourceRef } from '@bupa/contracts';

/**
 * Conversation history for the in-browser demo: plain data plus pure functions, so the same
 * rules can be unit-tested without a browser and later mirrored by the server repository.
 *
 * - Conversations are only listed once they have an entry; blank "new chat" pages never exist
 *   as records.
 * - `order` is the stable position of an entry; updating a tool row keeps its order.
 * - Deleting a conversation removes its content and leaves a tombstone so a late event cannot
 *   re-create it.
 */

export interface HistoryState {
  conversations: Record<string, Conversation>;
  /** Entries per conversation, kept sorted by `order`. */
  entries: Record<string, ConversationEntry[]>;
  /** Idempotency: create requestId → conversation id. */
  createRequests: Record<string, string>;
  tombstones: string[];
}

export function emptyHistory(): HistoryState {
  return { conversations: {}, entries: {}, createRequests: {}, tombstones: [] };
}

export const TITLE_MAX = 32;

/** Deterministic title from the first user message: first line, trimmed, truncated. */
export function titleFromMessage(text: string) {
  const firstLine =
    text
      .replace(/\s+/g, ' ')
      .trim()
      .split(/[。！？.!?\n]/)[0]
      ?.trim() ?? '';
  const base = firstLine || text.trim();
  return base.length > TITLE_MAX ? `${base.slice(0, TITLE_MAX - 1)}…` : base;
}

export function isDeleted(state: HistoryState, conversationId: string) {
  return state.tombstones.includes(conversationId);
}

export function getConversation(state: HistoryState, id: string) {
  return state.conversations[id] ?? null;
}

export function getEntries(state: HistoryState, conversationId: string) {
  return state.entries[conversationId] ?? [];
}

export function getEntry(state: HistoryState, conversationId: string, entryId: string) {
  return getEntries(state, conversationId).find((entry) => entry.id === entryId) ?? null;
}

/** Non-empty conversations, newest activity first. Reading never changes the order. */
export function listConversations(state: HistoryState) {
  return Object.values(state.conversations)
    .filter((conversation) => (state.entries[conversation.id]?.length ?? 0) > 0)
    .sort(
      (a, b) =>
        (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0) ||
        (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0) ||
        a.id.localeCompare(b.id),
    );
}

export function createConversation(
  state: HistoryState,
  input: { id: string; requestId: string; now: string; originSuggestionId?: string | null },
): Conversation {
  const existingId = state.createRequests[input.requestId];
  const existing = existingId ? state.conversations[existingId] : undefined;
  if (existing) return existing;
  const conversation: Conversation = {
    id: input.id,
    title: '',
    createdAt: input.now,
    updatedAt: input.now,
    activeDraftId: null,
    originSuggestionId: input.originSuggestionId ?? null,
    latestTurn: null,
    seeded: false,
  };
  state.conversations[conversation.id] = conversation;
  state.entries[conversation.id] = [];
  state.createRequests[input.requestId] = conversation.id;
  return conversation;
}

export function insertSeed(
  state: HistoryState,
  seed: { conversation: Conversation; entries: ConversationEntry[] },
) {
  state.conversations[seed.conversation.id] = seed.conversation;
  state.entries[seed.conversation.id] = [...seed.entries].sort((a, b) => a.order - b.order);
}

/** `Omit` that keeps the discriminated union instead of collapsing it to the common keys. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type EntryInput = DistributiveOmit<
  ConversationEntry,
  'id' | 'conversationId' | 'order' | 'createdAt'
> & { id?: string };

/**
 * Appends an entry, assigns the next `order`, and bumps the conversation's `updatedAt`.
 * The first user message also sets the title.
 */
export function appendEntry(
  state: HistoryState,
  conversationId: string,
  input: EntryInput,
  now: string,
  nextId: () => string,
): ConversationEntry {
  const conversation = state.conversations[conversationId];
  if (!conversation || isDeleted(state, conversationId)) throw new Error('CONVERSATION_NOT_FOUND');
  const list = (state.entries[conversationId] ??= []);
  const order = list.length ? list[list.length - 1]!.order + 1 : 0;
  const { id, ...rest } = input;
  const entry = {
    ...rest,
    id: id ?? nextId(),
    conversationId,
    order,
    createdAt: now,
  } as ConversationEntry;
  list.push(entry);
  conversation.updatedAt = now;
  if (entry.kind === 'user' && !conversation.title)
    conversation.title = titleFromMessage(entry.text);
  return entry;
}

export function updateEntry<K extends ConversationEntry['kind']>(
  state: HistoryState,
  conversationId: string,
  entryId: string,
  patch: Partial<Extract<ConversationEntry, { kind: K }>>,
) {
  const list = state.entries[conversationId];
  const index = list?.findIndex((entry) => entry.id === entryId) ?? -1;
  if (!list || index < 0) return null;
  const next = { ...list[index]!, ...patch } as ConversationEntry;
  list[index] = next;
  return next;
}

export function findUserEntryByClientId(
  state: HistoryState,
  conversationId: string,
  clientMessageId: string,
) {
  return getEntries(state, conversationId).find(
    (entry) => entry.kind === 'user' && entry.clientMessageId === clientMessageId,
  );
}

/**
 * Removes a conversation and its content. Returns the ids of derived entries in *other*
 * conversations that referred to it, after redacting them, so callers can report the change.
 */
export function deleteConversation(state: HistoryState, conversationId: string) {
  delete state.conversations[conversationId];
  delete state.entries[conversationId];
  for (const [requestId, id] of Object.entries(state.createRequests)) {
    if (id === conversationId) delete state.createRequests[requestId];
  }
  if (!state.tombstones.includes(conversationId)) state.tombstones.push(conversationId);
  const redacted: string[] = [];
  for (const list of Object.values(state.entries)) {
    for (let index = 0; index < list.length; index += 1) {
      const entry = list[index]!;
      if (
        (entry.kind === 'user' || entry.kind === 'assistant') &&
        entry.sourceRefs.some((ref) => ref.conversationId === conversationId)
      ) {
        list[index] = redactDerivedEntry(entry);
        redacted.push(entry.id);
      }
    }
  }
  return redacted;
}

/** Derived prompts lose their text once the source they were built from is gone. */
function redactDerivedEntry(
  entry: Extract<ConversationEntry, { kind: 'user' | 'assistant' }>,
): ConversationEntry {
  return { ...entry, text: '', sourceRefs: [] as SourceRef[] };
}

/** Marks anything still "running" as interrupted—used after a reload or an abort. */
export function interruptOpenWork(state: HistoryState, conversationId: string, turnId?: string) {
  const conversation = state.conversations[conversationId];
  if (!conversation) return;
  if (
    conversation.latestTurn?.status === 'running' &&
    (!turnId || conversation.latestTurn.id === turnId)
  )
    conversation.latestTurn = { ...conversation.latestTurn, status: 'interrupted' };
  const list = state.entries[conversationId] ?? [];
  for (let index = 0; index < list.length; index += 1) {
    const entry = list[index]!;
    if (turnId && entry.turnId !== turnId) continue;
    if (entry.kind === 'tool' && entry.status === 'running')
      list[index] = { ...entry, status: 'interrupted' };
    if (entry.kind === 'consent' && entry.status === 'pending')
      list[index] = { ...entry, status: 'expired' };
  }
}

/** All still-existing user messages the member typed themselves, oldest first. */
export function userReports(state: HistoryState) {
  const reports: Array<Extract<ConversationEntry, { kind: 'user' }>> = [];
  for (const conversation of Object.values(state.conversations)) {
    for (const entry of state.entries[conversation.id] ?? []) {
      if (entry.kind === 'user' && entry.origin === 'user_input' && entry.text.trim())
        reports.push(entry);
    }
  }
  return reports.sort((a, b) =>
    a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0,
  );
}
