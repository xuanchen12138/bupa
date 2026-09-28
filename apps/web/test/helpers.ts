import type { ConversationStreamEvent } from '@bupa/contracts';
import { MockService, type PersistedState } from '../src/mock/service.ts';
import { MemorySnapshotStore } from '../src/mock/persistence.ts';

/** A service on an in-memory store with a controllable clock. */
export function createService(options: { now?: Date; locale?: 'en' | 'zh' } = {}) {
  const store = new MemorySnapshotStore<PersistedState>();
  let current = options.now ?? new Date('2026-09-28T10:00:00');
  const service = new MockService({
    store,
    now: () => current,
    locale: options.locale ?? 'zh',
  });
  return {
    service,
    store,
    /** Reopen the same store as a fresh page load would. */
    reload: () => new MockService({ store, now: () => current, locale: options.locale ?? 'zh' }),
    advance: (ms: number) => {
      current = new Date(current.getTime() + ms);
    },
  };
}

/** Runs a full turn and collects the stream. Consent cards are answered by `onConsent`. */
export async function runTurn(
  service: MockService,
  conversationId: string,
  message: string,
  options: {
    clientMessageId?: string;
    onConsent?: 'session' | 'always' | 'deny' | null;
    originSuggestionId?: string | null;
    openDraftId?: string | null;
    signal?: AbortSignal;
  } = {},
) {
  const events: ConversationStreamEvent[] = [];
  await service.sendTurn(
    conversationId,
    {
      clientMessageId: options.clientMessageId ?? `c-${Math.random().toString(36).slice(2)}`,
      message,
      uiLocale: 'zh',
      openDraftId: options.openDraftId ?? null,
      originSuggestionId: options.originSuggestionId ?? null,
    },
    (event) => {
      events.push(event);
      if (event.payload.type === 'consent_request' && options.onConsent !== null) {
        void service.respondConsent(event.payload.request.id, options.onConsent ?? 'session');
      }
    },
    options.signal,
  );
  return events;
}

export const types = (events: ConversationStreamEvent[]) => events.map((e) => e.payload.type);
