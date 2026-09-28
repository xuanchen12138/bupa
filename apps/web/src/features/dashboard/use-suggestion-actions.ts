import { useRef, useState } from 'react';
import type { HealthOverviewResponse, HealthSuggestion, SourceRef } from '@bupa/contracts';
import { toast } from '@/components/ui/toast';
import { useT } from '@/i18n';
import { api, isApiError } from '@/lib/api';
import { keys, queryClient } from '@/lib/query';
import { useChat } from '@/stores/chat';
import { useNavigation } from '@/stores/navigation';

const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

/**
 * The three things a member can do with a suggestion, plus source navigation.
 * Every action carries the suggestion id and the snapshot it was shown from, so a stale card
 * is refused by the service rather than acted on; `requestId`s make double clicks harmless.
 */
export function useSuggestionActions() {
  const { t, locale } = useT();
  const navigate = useNavigation((s) => s.navigate);
  const focusBooking = useNavigation((s) => s.focusBooking);
  const focusEntry = useChat((s) => s.focusEntry);
  const select = useChat((s) => s.select);
  const send = useChat((s) => s.send);
  const setComposerPrefill = useChat((s) => s.setComposerPrefill);
  const [busyId, setBusyId] = useState<string | null>(null);
  const requestIds = useRef(new Map<string, string>());

  const refreshOverview = () => queryClient.refetchQueries({ queryKey: keys.healthOverview });

  const handleError = async (error: unknown) => {
    if (isApiError(error, 'STALE_SUGGESTION')) {
      await refreshOverview();
      toast({ title: t('suggest.stale'), tone: 'info' });
    } else if (isApiError(error, 'SOURCE_REMOVED')) {
      await refreshOverview();
      toast({ title: t('suggest.sourceRemoved'), tone: 'info' });
    } else {
      toast({ title: error instanceof Error ? error.message : 'Unexpected error', tone: 'info' });
    }
  };

  const viewSource = (ref: SourceRef) => {
    navigate('chat');
    void focusEntry(ref.conversationId, ref.messageId);
  };

  /** Opens the original conversation at the source message with an editable prompt ready. */
  const updateStatus = async (sourceRefs: SourceRef[]) => {
    const ref = sourceRefs[0];
    if (!ref) return;
    navigate('chat');
    await focusEntry(ref.conversationId, ref.messageId);
    setComposerPrefill(t('suggest.prefill'));
  };

  /** Creates or resumes the dedicated follow-up conversation, then sends the chosen request. */
  const prepareBooking = async (suggestion: HealthSuggestion, overview: HealthOverviewResponse) => {
    if (busyId) return;
    setBusyId(suggestion.id);
    const key = `${suggestion.id}:${overview.snapshotRevision}`;
    const requestId = requestIds.current.get(key) ?? uid();
    requestIds.current.set(key, requestId);
    try {
      const started = await api.startSuggestion(suggestion.id, {
        requestId,
        expectedSnapshotRevision: overview.snapshotRevision,
      });
      navigate('chat');
      await select(started.conversationId);
      await send(started.initialMessage[locale], {
        conversationId: started.conversationId,
        clientMessageId: started.clientMessageId,
        originSuggestionId: started.originSuggestionId,
      });
    } catch (error) {
      await handleError(error);
    } finally {
      setBusyId(null);
      void refreshOverview();
    }
  };

  const continueFollowUp = async (suggestion: HealthSuggestion) => {
    if (!suggestion.followUpConversationId) return;
    navigate('chat');
    await select(suggestion.followUpConversationId);
  };

  const dismiss = async (suggestion: HealthSuggestion, overview: HealthOverviewResponse) => {
    if (busyId) return;
    setBusyId(suggestion.id);
    try {
      const next = await api.dismissSuggestion(suggestion.id, {
        expectedSnapshotRevision: overview.snapshotRevision,
      });
      queryClient.setQueryData(keys.healthOverview, next);
    } catch (error) {
      await handleError(error);
    } finally {
      setBusyId(null);
    }
  };

  const viewBooking = (bookingId: string) => {
    focusBooking(bookingId);
    navigate('dashboard');
  };

  return {
    busyId,
    viewSource,
    updateStatus,
    prepareBooking,
    continueFollowUp,
    dismiss,
    viewBooking,
  };
}
