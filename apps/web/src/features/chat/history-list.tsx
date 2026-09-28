import { ChevronDown, ChevronRight, MessageSquarePlus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Conversation } from '@bupa/contracts';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/primitives';
import { toast } from '@/components/ui/toast';
import { useT, type Locale } from '@/i18n';
import { api } from '@/lib/api';
import { formatTime, isSameDay } from '@/lib/format';
import { keys } from '@/lib/query';
import { cn } from '@/lib/utils';
import { useChat } from '@/stores/chat';
import { useNavigation } from '@/stores/navigation';

type Group = 'today' | 'yesterday' | 'earlier';

function groupOf(iso: string): Group {
  const date = new Date(iso);
  const now = new Date();
  if (isSameDay(date, now)) return 'today';
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameDay(date, yesterday)) return 'yesterday';
  return 'earlier';
}

function whenLabel(iso: string, group: Group, locale: Locale) {
  if (group === 'today') return formatTime(iso, locale);
  return new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-AU', {
    day: 'numeric',
    month: 'short',
  }).format(new Date(iso));
}

/** Sidebar history: new conversation, grouped list, delete with confirmation. */
export function HistoryList() {
  const { t, locale } = useT();
  const enabled = api.features.conversations;
  const list = useQuery({ queryKey: keys.conversations, queryFn: api.conversations, enabled });
  const overview = useQuery({
    queryKey: keys.healthOverview,
    queryFn: api.healthOverview,
    enabled: api.features.personalization,
  });
  const selectedId = useChat((s) => s.selectedId);
  const select = useChat((s) => s.select);
  const startNew = useChat((s) => s.startNew);
  const deleteConversation = useChat((s) => s.deleteConversation);
  const views = useChat((s) => s.views);
  const runningIds = Object.keys(views).filter((id) => views[id]?.running);
  const { page, navigate, historyOpen, toggleHistory } = useNavigation();
  const [pendingDelete, setPendingDelete] = useState<Conversation | null>(null);
  const [deleting, setDeleting] = useState(false);

  const sourceIds = new Set(
    overview.data?.facts.flatMap((fact) => fact.sources.map((s) => s.conversationId)) ?? [],
  );
  const items = list.data?.items ?? [];
  const groups: Array<[Group, Conversation[]]> = (['today', 'yesterday', 'earlier'] as const)
    .map(
      (group) =>
        [group, items.filter((c) => groupOf(c.updatedAt) === group)] as [Group, Conversation[]],
    )
    .filter(([, list]) => list.length > 0);

  const open = async (id: string) => {
    navigate('chat');
    await select(id);
  };
  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await deleteConversation(pendingDelete.id);
      toast({ title: t('history.deleted'), body: pendingDelete.title, tone: 'info' });
      setPendingDelete(null);
    } catch (error) {
      toast({
        title: t('history.deleteFailed'),
        body: error instanceof Error ? error.message : undefined,
        tone: 'info',
      });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="mt-5 flex min-h-0 flex-1 flex-col">
      <button
        type="button"
        onClick={() => {
          void startNew();
          navigate('chat');
        }}
        className={cn(
          'flex w-full items-center gap-3 rounded-xl border border-dashed border-border-strong px-3 py-2 text-left text-sm font-medium transition-colors hover:border-primary/60 hover:bg-primary-soft/40 focus-visible:outline-2 focus-visible:outline-ring',
          page === 'chat' &&
            selectedId === null &&
            'border-primary/60 bg-primary-soft/40 text-primary-strong',
        )}
      >
        <MessageSquarePlus size={16} aria-hidden="true" />
        {t('history.new')}
      </button>

      <button
        type="button"
        onClick={toggleHistory}
        aria-expanded={historyOpen}
        aria-controls="history-list"
        className="mt-4 flex w-full items-center justify-between px-2 text-[11px] font-semibold uppercase tracking-wider text-subtle hover:text-foreground"
      >
        {t('history.title')}
        {historyOpen ? (
          <ChevronDown size={13} aria-hidden="true" />
        ) : (
          <ChevronRight size={13} aria-hidden="true" />
        )}
        <span className="sr-only">{historyOpen ? t('history.collapse') : t('history.expand')}</span>
      </button>

      {historyOpen ? (
        <div id="history-list" className="scroll-quiet mt-2 min-h-0 flex-1 overflow-y-auto pr-1">
          {!enabled ? (
            <p className="px-2 py-3 text-xs leading-5 text-muted-foreground">
              {t('history.unavailable')}
            </p>
          ) : list.isError ? (
            <p className="px-2 py-3 text-xs leading-5 text-destructive">{t('history.loadError')}</p>
          ) : items.length === 0 && list.isSuccess ? (
            <p className="px-2 py-3 text-xs leading-5 text-muted-foreground">
              {t('history.empty')}
            </p>
          ) : (
            groups.map(([group, conversations]) => (
              <div key={group} className="mb-3">
                <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-subtle/80">
                  {t(`history.${group}`)}
                </p>
                <ul className="space-y-0.5">
                  {conversations.map((conversation) => {
                    const active = page === 'chat' && conversation.id === selectedId;
                    const running = runningIds.includes(conversation.id);
                    return (
                      <li
                        key={conversation.id}
                        className={cn(
                          'group relative flex items-center rounded-lg transition-colors',
                          active ? 'bg-primary-soft text-primary-strong' : 'hover:bg-muted',
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => void open(conversation.id)}
                          aria-current={active ? 'true' : undefined}
                          className="flex min-w-0 flex-1 flex-col items-start gap-0.5 px-2.5 py-2 text-left focus-visible:outline-2 focus-visible:outline-ring"
                        >
                          <span className="flex w-full items-center gap-1.5">
                            {running ? (
                              <span
                                aria-hidden="true"
                                className="size-1.5 shrink-0 rounded-full bg-primary animate-pulse-soft"
                              />
                            ) : null}
                            <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                              {conversation.title || '…'}
                            </span>
                          </span>
                          <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                            {whenLabel(conversation.updatedAt, group, locale)}
                            {conversation.seeded ? (
                              <span className="rounded-full bg-muted px-1.5 text-[9px] font-semibold uppercase tracking-wider text-subtle">
                                {t('history.sample')}
                              </span>
                            ) : null}
                          </span>
                        </button>
                        <button
                          type="button"
                          aria-label={`${t('history.delete')}: ${conversation.title}`}
                          onClick={() => setPendingDelete(conversation)}
                          className="mr-1 rounded-md p-1.5 text-subtle opacity-0 transition-opacity hover:bg-card hover:text-destructive focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-ring group-hover:opacity-100"
                        >
                          <Trash2 size={14} aria-hidden="true" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))
          )}
        </div>
      ) : (
        <div className="min-h-0 flex-1" />
      )}

      <Dialog
        open={pendingDelete !== null}
        onClose={() => (deleting ? undefined : setPendingDelete(null))}
        title={t('history.deleteTitle')}
        description={pendingDelete?.title}
        footer={
          <>
            <Button variant="ghost" disabled={deleting} onClick={() => setPendingDelete(null)}>
              {t('common.cancel')}
            </Button>
            <Button variant="destructive" disabled={deleting} onClick={() => void confirmDelete()}>
              {t('common.delete')}
            </Button>
          </>
        }
      >
        <p className="text-sm leading-6 text-muted-foreground">
          {pendingDelete && sourceIds.has(pendingDelete.id)
            ? t('history.deleteSourceBody')
            : t('history.deleteBody')}
        </p>
      </Dialog>
    </div>
  );
}
