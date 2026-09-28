import { create } from 'zustand';
import type {
  Booking,
  ChatEvent,
  ConsentDecision,
  ConsentRequest,
  Conversation,
  ConversationEntry,
  ConversationStreamEvent,
  Receipt,
} from '@bupa/contracts';
import { api, isApiError } from '@/lib/api';
import { isAbortError } from '@/lib/errors';
import { forgetConversation, invalidateAll, keys, queryClient } from '@/lib/query';
import { useLocale } from '@/i18n';
import { titleFromMessage } from '@/mock/history-repository';
import { useWizard } from './wizard';

/**
 * Conversation state, keyed by conversationId.
 *
 * The server (mock or api) owns the persisted entries; this store keeps a live view per
 * conversation, applies stream events to it, and remembers which conversation is selected.
 * Every callback captures the conversationId it started with, so a late event from an old
 * turn can never touch a newer conversation.
 */

export type ChatItem = ConversationEntry & { optimistic?: boolean };

export interface ConversationView {
  conversation: Conversation | null;
  items: ChatItem[];
  loaded: boolean;
  loading: boolean;
  error: string | null;
  running: boolean;
  turnId: string | null;
  pendingConsentId: string | null;
  /** The last turn stopped before it finished (switch, delete, reload). */
  interrupted: boolean;
}

export const LEGACY_ID = 'legacy';
const SELECTED_KEY = 'my-bupa-agent.selectedConversation';
const legacy = !api.features.conversations;

const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const initialViews = (): Record<string, ConversationView> =>
  legacy ? { [LEGACY_ID]: { ...emptyView(), loaded: true } } : {};
const emptyView = (): ConversationView => ({
  conversation: null,
  items: [],
  loaded: false,
  loading: false,
  error: null,
  running: false,
  turnId: null,
  pendingConsentId: null,
  interrupted: false,
});

function readSelected(): string | null {
  if (legacy) return LEGACY_ID;
  try {
    return localStorage.getItem(SELECTED_KEY);
  } catch {
    return null;
  }
}
function storeSelected(id: string | null) {
  if (legacy) return;
  try {
    if (id) localStorage.setItem(SELECTED_KEY, id);
    else localStorage.removeItem(SELECTED_KEY);
  } catch {
    // Storage is a convenience only.
  }
}

/** Runtime controllers never enter the store or any snapshot. */
const runs = new Map<string, { controller: AbortController; turnId: string | null }>();
/** Full consent requests for cards that are still answerable in this session. */
const liveConsents = new Map<string, ConsentRequest>();

type SendOptions = {
  conversationId?: string;
  clientMessageId?: string;
  originSuggestionId?: string | null;
};

type ChatState = {
  legacy: boolean;
  /** Null means a blank "new conversation" page. */
  selectedId: string | null;
  views: Record<string, ConversationView>;
  /** Idempotency key for the conversation the blank page will create on first send. */
  createRequestId: string;
  creating: boolean;
  /** Text placed in the composer for the member to edit (e.g. from "update how it is now"). */
  composerPrefill: string | null;
  /** Entry to scroll to and highlight; auto-scroll pauses while set. */
  focusEntryId: string | null;
  showTranslations: boolean;
  toggleTranslations: () => void;
  select: (id: string | null) => Promise<void>;
  startNew: () => Promise<void>;
  load: (id: string, force?: boolean) => Promise<void>;
  send: (text: string, options?: SendOptions) => Promise<void>;
  respondConsent: (id: string, decision: ConsentDecision) => Promise<void>;
  cancelRunning: (conversationId?: string) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  focusEntry: (conversationId: string, entryId: string) => Promise<void>;
  clearFocus: () => void;
  setComposerPrefill: (text: string | null) => void;
  liveConsent: (id: string) => ConsentRequest | undefined;
  /**
   * Called by the wizard after the member submits. The result belongs to the draft's
   * conversation (the server appended it there); in legacy mode it is shown locally.
   */
  notifyBooking: (booking: Booking, receipt: Receipt, conversationId: string | null) => void;
  /** After "reset demo": forget every view and start blank. */
  reset: () => void;
};

export const useChat = create<ChatState>((set, get) => {
  const update = (id: string, fn: (view: ConversationView) => Partial<ConversationView>) =>
    set((state) => {
      const view = state.views[id] ?? emptyView();
      return { views: { ...state.views, [id]: { ...view, ...fn(view) } } };
    });
  const push = (id: string, item: ChatItem) =>
    update(id, (view) => ({ items: [...view.items, item] }));
  const nextOrder = (view: ConversationView) => (view.items.at(-1)?.order ?? -1) + 1;

  const applyChatEvent = (cid: string, event: ChatEvent, entryId: string | null) => {
    // Without a persisted entry id (legacy /chat), tool rows key off the event id so that
    // running → done updates the same row.
    const id = entryId ?? (event.type === 'tool_status' ? `tool-${event.id}` : uid());
    const base = {
      id,
      conversationId: cid,
      turnId: get().views[cid]?.turnId ?? null,
      createdAt: new Date().toISOString(),
    };
    const withOrder = <T extends object>(view: ConversationView, item: T) => ({
      ...item,
      order: nextOrder(view),
    });
    switch (event.type) {
      case 'message':
        update(cid, (view) => ({
          items: [
            ...view.items,
            withOrder(view, {
              ...base,
              kind: 'assistant' as const,
              text: event.text,
              translation: event.translation,
              suggestions: event.suggestions,
              sourceRefs: [],
            }),
          ],
        }));
        break;
      case 'tool_status':
        update(cid, (view) => {
          const index = view.items.findIndex(
            (item) => item.kind === 'tool' && (item.id === id || item.id === event.id),
          );
          const item = {
            ...base,
            id: index >= 0 ? view.items[index]!.id : id,
            kind: 'tool' as const,
            tool: event.tool,
            label: event.label,
            status: event.status,
          };
          if (index >= 0) {
            const items = [...view.items];
            items[index] = { ...items[index]!, ...item, order: items[index]!.order };
            return { items };
          }
          return { items: [...view.items, withOrder(view, item)] };
        });
        break;
      case 'consent_request':
        liveConsents.set(event.request.id, event.request);
        update(cid, (view) => ({
          pendingConsentId: event.request.id,
          items: [
            ...view.items,
            withOrder(view, {
              ...base,
              kind: 'consent' as const,
              consentId: event.request.id,
              dataLabel: event.request.dataLabel,
              purpose: event.request.purpose,
              benefit: event.request.benefit,
              sensitive: event.request.sensitive,
              status: 'pending' as const,
              scope: null,
            }),
          ],
        }));
        break;
      case 'consent_resolved':
        liveConsents.delete(event.requestId);
        update(cid, () => ({ pendingConsentId: null }));
        if (entryId && !legacy) {
          // The persisted entry knows the outcome and scope; read it back rather than guess.
          void api
            .conversationEntry(cid, entryId)
            .then((entry) =>
              update(cid, (view) => ({
                items: view.items.map((item) => (item.id === entryId ? { ...entry } : item)),
              })),
            )
            .catch(() => undefined);
        }
        break;
      case 'receipt':
        update(cid, (view) => ({
          items: [
            ...view.items,
            withOrder(view, { ...base, kind: 'receipt' as const, receiptId: event.receipt.id }),
          ],
        }));
        invalidateAll();
        break;
      case 'wizard_open':
        update(cid, (view) => ({
          items: [
            ...view.items,
            withOrder(view, {
              ...base,
              kind: 'wizard' as const,
              draftId: event.draft.id,
              mode: 'open' as const,
              changed: [],
            }),
          ],
        }));
        if (get().selectedId === cid) useWizard.getState().open(event.draft.id, 'chat', cid);
        invalidateAll();
        break;
      case 'wizard_prefill':
        update(cid, (view) => ({
          items: [
            ...view.items,
            withOrder(view, {
              ...base,
              kind: 'wizard' as const,
              draftId: event.draft.id,
              mode: 'update' as const,
              changed: event.changed,
            }),
          ],
        }));
        if (get().selectedId === cid) {
          const wizard = useWizard.getState();
          if (!wizard.openDraftId) wizard.open(event.draft.id, 'chat', cid);
          wizard.highlight(event.changed);
        }
        invalidateAll();
        break;
      case 'action_done':
        push(cid, {
          ...base,
          order: nextOrder(get().views[cid] ?? emptyView()),
          kind: 'booking',
          bookingId: event.booking.id,
        });
        invalidateAll();
        break;
      case 'safety_alert':
        push(cid, {
          ...base,
          order: nextOrder(get().views[cid] ?? emptyView()),
          kind: 'safety',
          message: event.message,
          resources: event.resources,
        });
        break;
      case 'handoff':
        push(cid, {
          ...base,
          order: nextOrder(get().views[cid] ?? emptyView()),
          kind: 'handoff',
          summary: event.summary,
          ticket: event.ticket,
        });
        break;
      case 'error':
        push(cid, {
          ...base,
          order: nextOrder(get().views[cid] ?? emptyView()),
          kind: 'error',
          message: event.message,
          retryable: false,
        });
        break;
      case 'done':
        break;
    }
  };

  const applyStreamEvent = (cid: string, event: ConversationStreamEvent) => {
    if (event.conversationId !== cid) return;
    const run = runs.get(cid);
    if (run && run.turnId && run.turnId !== event.turnId) return; // a stale turn
    if (run && !run.turnId) run.turnId = event.turnId;
    if (event.payload.type === 'turn_accepted') {
      const { userMessageId, clientMessageId } = event.payload;
      update(cid, (view) => {
        const sent = view.items.find(
          (item): item is Extract<ChatItem, { kind: 'user' }> =>
            item.kind === 'user' && item.clientMessageId === clientMessageId,
        );
        return {
          turnId: event.turnId,
          // The server sets the real title from the first message; show the same thing meanwhile.
          conversation:
            view.conversation && !view.conversation.title && sent
              ? { ...view.conversation, title: titleFromMessage(sent.text) }
              : view.conversation,
          items: view.items.map((item) =>
            item.kind === 'user' && item.clientMessageId === clientMessageId
              ? { ...item, id: userMessageId, turnId: event.turnId, optimistic: false }
              : item,
          ),
        };
      });
      return;
    }
    applyChatEvent(cid, event.payload, event.entryId);
  };

  return {
    legacy,
    selectedId: readSelected(),
    views: initialViews(),
    createRequestId: uid(),
    creating: false,
    composerPrefill: null,
    focusEntryId: null,
    showTranslations: false,
    toggleTranslations: () => set((state) => ({ showTranslations: !state.showTranslations })),
    liveConsent: (id) => liveConsents.get(id),

    load: async (id, force = false) => {
      if (legacy) return;
      const current = get().views[id];
      if (current?.loading || (current?.loaded && !force)) return;
      update(id, () => ({ loading: true, error: null }));
      try {
        const response = await api.conversationMessages(id);
        update(id, (view) => ({
          conversation: response.conversation,
          items: response.items,
          loaded: true,
          loading: false,
          error: null,
          interrupted: view.running
            ? view.interrupted
            : response.conversation.latestTurn?.status === 'interrupted',
        }));
      } catch (error) {
        if (isApiError(error, 'CONVERSATION_NOT_FOUND')) {
          set((state) => {
            const views = { ...state.views };
            delete views[id];
            const selectedId = state.selectedId === id ? null : state.selectedId;
            if (selectedId !== state.selectedId) storeSelected(selectedId);
            return { views, selectedId };
          });
          return;
        }
        update(id, () => ({
          loading: false,
          error: error instanceof Error ? error.message : 'Could not load this conversation',
        }));
      }
    },

    select: async (id) => {
      const previous = get().selectedId;
      if (previous && previous !== id && get().views[previous]?.running) {
        await get().cancelRunning(previous);
      }
      const wizard = useWizard.getState();
      if (wizard.host === 'chat' && wizard.conversationId !== id) wizard.close();
      set({ selectedId: id, focusEntryId: null, composerPrefill: null });
      storeSelected(id);
      if (id) await get().load(id);
    },

    startNew: async () => {
      await get().select(null);
      set({ createRequestId: uid() });
    },

    send: async (text, options = {}) => {
      const message = text.trim();
      if (!message) return;
      let cid = legacy ? LEGACY_ID : (options.conversationId ?? get().selectedId);
      if (!cid) {
        if (get().creating) return;
        set({ creating: true });
        try {
          const conversation = await api.createConversation({ requestId: get().createRequestId });
          cid = conversation.id;
          set({ selectedId: cid, createRequestId: uid() });
          storeSelected(cid);
          update(cid, () => ({ conversation, loaded: true }));
        } catch (error) {
          push('__blank__', {
            kind: 'error',
            id: uid(),
            conversationId: '__blank__',
            turnId: null,
            order: 0,
            createdAt: new Date().toISOString(),
            message: error instanceof Error ? error.message : 'Could not start a conversation',
            retryable: true,
          });
          return;
        } finally {
          set({ creating: false });
        }
      }
      const conversationId = cid;
      if (get().views[conversationId]?.running) return;

      const clientMessageId = options.clientMessageId ?? uid();
      const controller = new AbortController();
      runs.set(conversationId, { controller, turnId: null });
      update(conversationId, (view) => ({
        running: true,
        interrupted: false,
        pendingConsentId: null,
        error: null,
        items: [
          ...view.items,
          {
            kind: 'user',
            id: `optimistic-${clientMessageId}`,
            conversationId,
            turnId: null,
            order: nextOrder(view),
            createdAt: new Date().toISOString(),
            text: message,
            clientMessageId,
            origin: options.originSuggestionId ? 'suggestion_action' : 'user_input',
            sourceRefs: [],
            optimistic: true,
          },
        ],
      }));
      set({ focusEntryId: null, composerPrefill: null });

      const wizard = useWizard.getState();
      const openDraftId =
        wizard.openDraftId && (legacy || wizard.conversationId === conversationId)
          ? wizard.openDraftId
          : null;
      let sawEvent = false;
      try {
        if (legacy) {
          await api.chat(
            {
              sessionId: 'session-demo',
              message,
              uiLocale: useLocale.getState().locale,
              openDraftId,
            },
            (event) => {
              sawEvent = true;
              applyChatEvent(conversationId, event, null);
            },
            controller.signal,
          );
        } else {
          await api.sendTurn(
            conversationId,
            {
              clientMessageId,
              message,
              uiLocale: useLocale.getState().locale,
              openDraftId,
              originSuggestionId: options.originSuggestionId ?? null,
            },
            (event) => {
              sawEvent = true;
              applyStreamEvent(conversationId, event);
            },
            controller.signal,
          );
          // A deduplicated retry streams nothing; the persisted result is the truth.
          if (!sawEvent) await get().load(conversationId, true);
          else {
            // Title and latest-turn status are set server-side; pick them up without replaying items.
            const fresh = await api.conversationMessages(conversationId).catch(() => null);
            if (fresh) update(conversationId, () => ({ conversation: fresh.conversation }));
          }
        }
      } catch (error) {
        if (isAbortError(error) || controller.signal.aborted) {
          update(conversationId, (view) => ({
            interrupted: true,
            items: view.items.map((item) =>
              item.kind === 'tool' && item.status === 'running'
                ? { ...item, status: 'interrupted' as const }
                : item.kind === 'consent' && item.status === 'pending'
                  ? { ...item, status: 'expired' as const }
                  : item,
            ),
          }));
        } else if (isApiError(error, 'CHAT_BUSY')) {
          update(conversationId, (view) => ({
            items: view.items.filter((item) => item.id !== `optimistic-${clientMessageId}`),
          }));
        } else {
          push(conversationId, {
            kind: 'error',
            id: uid(),
            conversationId,
            turnId: get().views[conversationId]?.turnId ?? null,
            order: nextOrder(get().views[conversationId] ?? emptyView()),
            createdAt: new Date().toISOString(),
            message: error instanceof Error ? error.message : 'Unexpected error',
            retryable: true,
          });
        }
      } finally {
        if (runs.get(conversationId)?.controller === controller) {
          runs.delete(conversationId);
          update(conversationId, () => ({ running: false, pendingConsentId: null, turnId: null }));
        }
        void queryClient.invalidateQueries({ queryKey: keys.conversations });
        void queryClient.invalidateQueries({ queryKey: keys.healthOverview });
      }
    },

    respondConsent: async (id, decision) => {
      const cid = Object.keys(get().views).find((key) =>
        get().views[key]?.items.some((item) => item.kind === 'consent' && item.consentId === id),
      );
      if (cid)
        update(cid, (view) => ({
          items: view.items.map((item) =>
            item.kind === 'consent' && item.consentId === id
              ? {
                  ...item,
                  status: decision === 'deny' ? ('denied' as const) : ('granted' as const),
                  scope: decision === 'deny' ? null : decision,
                }
              : item,
          ),
        }));
      await api.respondConsent(id, decision);
      liveConsents.delete(id);
      invalidateAll();
    },

    cancelRunning: async (conversationId) => {
      const cid = conversationId ?? get().selectedId;
      if (!cid) return;
      const run = runs.get(cid);
      if (!run) return;
      run.controller.abort();
      runs.delete(cid);
      update(cid, (view) => ({
        running: false,
        pendingConsentId: null,
        interrupted: true,
        items: view.items.map((item) =>
          item.kind === 'tool' && item.status === 'running'
            ? { ...item, status: 'interrupted' as const }
            : item.kind === 'consent' && item.status === 'pending'
              ? { ...item, status: 'expired' as const }
              : item,
        ),
      }));
      if (!legacy && run.turnId) {
        try {
          await api.cancelTurn(cid, run.turnId);
        } catch {
          // The local abort already stopped the stream; the server marks it on its side.
        }
      }
    },

    deleteConversation: async (id) => {
      await get().cancelRunning(id);
      await api.deleteConversation(id);
      const wizard = useWizard.getState();
      if (wizard.conversationId === id) wizard.close();
      set((state) => {
        const views: Record<string, ConversationView> = {};
        // Other conversations may hold prompts derived from the deleted one (now redacted
        // server-side), so they are re-read before they are shown again.
        for (const [key, view] of Object.entries(state.views)) {
          if (key !== id) views[key] = { ...view, loaded: false };
        }
        const selectedId = state.selectedId === id ? null : state.selectedId;
        storeSelected(selectedId);
        return { views, selectedId, focusEntryId: null };
      });
      const selected = get().selectedId;
      if (selected) void get().load(selected, true);
      forgetConversation(id);
      invalidateAll();
    },

    notifyBooking: (booking, receipt, conversationId) => {
      if (legacy) {
        if (useWizard.getState().host !== 'chat') return;
        const view = get().views[LEGACY_ID] ?? emptyView();
        const now = new Date().toISOString();
        update(LEGACY_ID, () => ({
          items: [
            ...view.items,
            {
              kind: 'booking',
              id: `booking-${booking.id}`,
              conversationId: LEGACY_ID,
              turnId: null,
              order: nextOrder(view),
              createdAt: now,
              bookingId: booking.id,
            },
            {
              kind: 'receipt',
              id: `receipt-${receipt.id}`,
              conversationId: LEGACY_ID,
              turnId: null,
              order: nextOrder(view) + 1,
              createdAt: now,
              receiptId: receipt.id,
            },
          ],
        }));
        return;
      }
      if (conversationId) void get().load(conversationId, true);
    },

    focusEntry: async (conversationId, entryId) => {
      await get().select(conversationId);
      set({ focusEntryId: entryId });
    },
    clearFocus: () => set({ focusEntryId: null }),
    setComposerPrefill: (text) => set({ composerPrefill: text }),

    reset: () => {
      for (const run of runs.values()) run.controller.abort();
      runs.clear();
      liveConsents.clear();
      storeSelected(null);
      set({
        selectedId: legacy ? LEGACY_ID : null,
        views: initialViews(),
        createRequestId: uid(),
        composerPrefill: null,
        focusEntryId: null,
      });
    },
  };
});
