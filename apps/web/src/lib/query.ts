import { QueryClient } from '@tanstack/react-query';
import { api } from './api';

export const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 5_000 } },
});

export const keys = {
  health: ['health'] as const,
  profile: ['profile'] as const,
  schedule: ['schedule'] as const,
  receipts: ['receipts'] as const,
  draft: (id: string) => ['draft', id] as const,
  providers: (service: string, postcode: string | null, language: string | null) =>
    ['providers', service, postcode, language] as const,
  conversations: ['conversations'] as const,
  conversation: (id: string) => ['conversation', id] as const,
  personalization: ['personalization'] as const,
  healthOverview: ['health-overview'] as const,
};

/** Refresh everything that server-side state changes can affect. */
export function invalidateAll() {
  void queryClient.invalidateQueries({ queryKey: keys.profile });
  void queryClient.invalidateQueries({ queryKey: keys.schedule });
  void queryClient.invalidateQueries({ queryKey: keys.receipts });
  void queryClient.invalidateQueries({ queryKey: ['draft'] });
  void queryClient.invalidateQueries({ queryKey: ['providers'] });
  void queryClient.invalidateQueries({ queryKey: keys.conversations });
  void queryClient.invalidateQueries({ queryKey: keys.personalization });
  void queryClient.invalidateQueries({ queryKey: keys.healthOverview });
}

/**
 * Deleting or withdrawing must make the old text disappear at once, so the deleted
 * conversation's cache is removed rather than merely marked stale.
 */
export function forgetConversation(id: string) {
  queryClient.removeQueries({ queryKey: keys.conversation(id) });
  void queryClient.refetchQueries({ queryKey: keys.conversations });
  void queryClient.refetchQueries({ queryKey: keys.healthOverview });
}

// The mock service mutates state during scripted conversations; keep the UI in sync.
// Coalesced, because a streaming turn commits on every event and the chat view already
// applies those events itself.
let pending: ReturnType<typeof setTimeout> | null = null;
api.subscribe(() => {
  if (pending) return;
  pending = setTimeout(() => {
    pending = null;
    invalidateAll();
  }, 250);
});
