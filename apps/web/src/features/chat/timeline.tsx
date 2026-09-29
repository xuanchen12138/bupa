import {
  AlertTriangle,
  CalendarCheck2,
  Check,
  ClipboardList,
  Languages,
  Loader2,
  Lock,
  Phone,
  ReceiptText,
  Sparkles,
  UserRound,
  X,
} from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { bookingWizard } from '@bupa/contracts/wizard';
import { ConsentCard } from '@/components/consent-card';
import { RichText } from '@/components/rich-text';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/primitives';
import { useT } from '@/i18n';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { keys } from '@/lib/query';
import { cn } from '@/lib/utils';
import { useChat, type ChatItem, type ConversationView } from '@/stores/chat';
import { useNavigation } from '@/stores/navigation';
import { useWizard } from '@/stores/wizard';

export function Timeline({
  conversationId,
  view,
}: {
  conversationId: string;
  view: ConversationView;
}) {
  const { t } = useT();
  const endRef = useRef<HTMLDivElement>(null);
  const focusEntryId = useChat((s) => s.focusEntryId);
  const clearFocus = useChat((s) => s.clearFocus);
  const items = view.items;

  // Auto-scroll pauses while a source message is being pointed at, so it is not scrolled away.
  useEffect(() => {
    if (focusEntryId) return;
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [items.length, view.running, focusEntryId]);

  useEffect(() => {
    if (!focusEntryId) return;
    const el = document.querySelector<HTMLElement>(`[data-entry-id="${focusEntryId}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const timer = setTimeout(clearFocus, 6000);
    return () => clearTimeout(timer);
  }, [focusEntryId, clearFocus, items.length]);

  const lastAssistant = [...items].reverse().find((i) => i.kind === 'assistant');
  const last = items.at(-1);
  return (
    <div className="mx-auto flex w-full max-w-[760px] flex-col gap-4 px-8 py-6">
      {items.map((item) => (
        <div
          key={item.id}
          data-entry-id={item.id}
          className={cn(
            'rounded-2xl transition-shadow',
            focusEntryId === item.id && 'entry-focused',
          )}
        >
          {focusEntryId === item.id ? (
            <p className="mb-1.5 pl-11 text-[11px] font-semibold uppercase tracking-wider text-primary">
              {t('chat.sourceHighlight')}
            </p>
          ) : null}
          <TimelineItem
            item={item}
            view={view}
            conversationId={conversationId}
            isLast={item === lastAssistant && !view.running}
          />
        </div>
      ))}
      {view.running && (last?.kind === 'user' || last?.kind === 'tool') ? <Typing /> : null}
      {!view.running && view.interrupted ? (
        <p className="flex items-center gap-2 pl-11 text-xs text-muted-foreground animate-fade-in">
          <span className="flex size-[13px] items-center justify-center rounded-full bg-muted text-muted-foreground">
            <X size={9} strokeWidth={3} aria-hidden="true" />
          </span>
          {t('history.interrupted')}
        </p>
      ) : null}
      <div ref={endRef} />
    </div>
  );
}

function Typing() {
  const { t } = useT();
  return (
    <div className="flex items-center gap-3 animate-fade-in">
      <Avatar />
      <div className="flex items-center gap-1 rounded-2xl rounded-tl-md bg-card px-4 py-3 shadow-sm">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="size-1.5 rounded-full bg-primary animate-dot"
            style={{ animationDelay: `${i * 0.15}s` }}
          />
        ))}
        <span className="sr-only">{t('chat.thinking')}</span>
      </div>
    </div>
  );
}

function Avatar() {
  return (
    <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-violet text-white shadow-sm">
      <Sparkles size={15} aria-hidden="true" />
    </div>
  );
}

function TimelineItem({
  item,
  view,
  conversationId,
  isLast,
}: {
  item: ChatItem;
  view: ConversationView;
  conversationId: string;
  isLast: boolean;
}) {
  const { t, tx, locale } = useT();
  const showTranslations = useChat((s) => s.showTranslations);
  const send = useChat((s) => s.send);
  const respondConsent = useChat((s) => s.respondConsent);
  const liveConsent = useChat((s) => s.liveConsent);
  const openWizard = useWizard((s) => s.open);
  const openDraftId = useWizard((s) => s.openDraftId);
  const { navigate, focusReceipt, focusBooking } = useNavigation();
  const schedule = useQuery({ queryKey: keys.schedule, queryFn: api.schedule });

  switch (item.kind) {
    case 'user':
      return (
        <div className="flex flex-col items-end gap-1 animate-fade-up">
          {item.origin === 'suggestion_action' ? (
            <span className="inline-flex items-center gap-1 text-[11px] text-subtle">
              <Sparkles size={11} aria-hidden="true" /> {t('chat.fromSuggestion')}
            </span>
          ) : null}
          <div
            className={cn(
              'max-w-[78%] rounded-2xl rounded-tr-md px-4 py-3 text-[15px] leading-6 shadow-md',
              item.text
                ? 'bg-primary text-primary-foreground'
                : 'border border-dashed border-border bg-card text-muted-foreground italic',
              item.optimistic && 'opacity-80',
            )}
          >
            {item.text || t('chat.redacted')}
          </div>
        </div>
      );

    case 'assistant':
      return (
        <div className="flex gap-3 animate-fade-up">
          <Avatar />
          <div className="min-w-0 max-w-[85%]">
            <div className="rounded-2xl rounded-tl-md border border-border bg-card px-4 py-3.5 text-[15px] leading-6 shadow-sm">
              {item.text ? (
                <RichText text={item.text} />
              ) : (
                <p className="italic text-muted-foreground">{t('chat.redacted')}</p>
              )}
              {showTranslations && item.translation ? (
                <div className="mt-3 border-t border-dashed border-border pt-3 text-[13px] leading-5 text-muted-foreground">
                  <p className="mb-1 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-subtle">
                    <Languages size={12} aria-hidden="true" /> {t('chat.translation')}
                  </p>
                  <RichText text={item.translation} />
                </div>
              ) : null}
            </div>
            {isLast && item.suggestions.length ? (
              <div className="mt-2.5 flex flex-wrap gap-2">
                {item.suggestions.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    disabled={view.running}
                    onClick={() => void send(suggestion, { conversationId })}
                    className="rounded-full border border-primary/30 bg-card px-3.5 py-1.5 text-[13px] font-medium text-primary-strong shadow-xs transition-all hover:-translate-y-px hover:border-primary hover:bg-primary-soft disabled:opacity-50"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      );

    case 'tool':
      return (
        <div className="flex items-center gap-2 pl-11 text-xs text-muted-foreground animate-fade-in">
          {item.status === 'running' ? (
            <Loader2 size={13} className="animate-spin text-primary" aria-hidden="true" />
          ) : item.status === 'done' ? (
            <span className="flex size-[13px] items-center justify-center rounded-full bg-success text-white">
              <Check size={9} strokeWidth={3} aria-hidden="true" />
            </span>
          ) : (
            <span className="flex size-[13px] items-center justify-center rounded-full bg-muted text-muted-foreground">
              <X size={9} strokeWidth={3} aria-hidden="true" />
            </span>
          )}
          <span className={cn(item.status === 'running' && 'animate-pulse-soft')}>
            {item.label}
            {item.status === 'interrupted' ? ` · ${t('chat.stopped')}` : ''}
          </span>
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-subtle">
            {item.tool}
          </code>
        </div>
      );

    case 'consent': {
      const live =
        item.status === 'pending' && view.pendingConsentId === item.consentId
          ? liveConsent(item.consentId)
          : undefined;
      if (live) {
        return (
          <div className="pl-11">
            <ConsentCard
              request={live}
              decision={null}
              onDecide={(decision) => void respondConsent(item.consentId, decision)}
            />
          </div>
        );
      }
      return (
        <div className="pl-11">
          <ConsentHistoryCard item={item} />
        </div>
      );
    }

    case 'receipt':
      return (
        <div className="pl-11 animate-fade-up">
          <button
            type="button"
            onClick={() => {
              focusReceipt(item.receiptId);
              navigate('profile');
            }}
            className="group inline-flex items-center gap-2 rounded-full border border-border bg-card py-1.5 pl-2.5 pr-3.5 text-xs text-muted-foreground shadow-xs transition-colors hover:border-primary/40 hover:text-foreground"
          >
            <ReceiptText size={14} className="text-primary" aria-hidden="true" />
            {t('chat.receiptSaved')}
            <span className="font-semibold text-primary group-hover:underline">
              {t('chat.viewReceipt')}
            </span>
          </button>
        </div>
      );

    case 'wizard': {
      const draftExists = schedule.data?.drafts.some((d) => d.id === item.draftId) ?? false;
      const changedLabels = item.changed.map((id) => {
        const def = bookingWizard.fields.find((field) => field.id === id);
        return def ? tx(def.label) : id;
      });
      return (
        <div className="pl-11 animate-fade-up">
          <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-3.5 py-2.5 text-sm shadow-xs">
            <ClipboardList size={16} className="shrink-0 text-primary" aria-hidden="true" />
            <span className="text-muted-foreground">
              {item.mode === 'open'
                ? t('chat.wizardOpened')
                : `${t('chat.wizardUpdated')} ${changedLabels.join(', ')}`}
            </span>
            {draftExists ? (
              openDraftId !== item.draftId ? (
                <Button
                  size="sm"
                  variant="soft"
                  className="ml-auto"
                  onClick={() => openWizard(item.draftId, 'chat', conversationId)}
                >
                  {t('chat.openWizard')}
                </Button>
              ) : null
            ) : (
              <Badge tone="neutral" className="ml-auto">
                {t('chat.wizardExpired')}
              </Badge>
            )}
          </div>
        </div>
      );
    }

    case 'booking': {
      const booking = schedule.data?.bookings.find((b) => b.id === item.bookingId);
      if (!booking) {
        return (
          <p className="pl-11 text-xs text-muted-foreground">
            {schedule.isLoading ? t('common.loading') : t('chat.bookingMissing')}
          </p>
        );
      }
      const cancelled = booking.status === 'cancelled';
      return (
        <div className="pl-11 animate-fade-up">
          <button
            type="button"
            onClick={() => {
              focusBooking(booking.id);
              navigate('dashboard');
            }}
            className={cn(
              'flex w-full items-center gap-3 rounded-xl border px-3.5 py-3 text-left text-sm transition-colors',
              cancelled
                ? 'border-border bg-muted/50 text-muted-foreground hover:bg-muted'
                : 'border-success/30 bg-success-soft/60 hover:bg-success-soft',
            )}
          >
            <CalendarCheck2
              size={18}
              className={cancelled ? 'text-muted-foreground' : 'text-success'}
              aria-hidden="true"
            />
            <span>
              <span className="font-semibold">
                {cancelled ? t('dash.cancelled') : t('chat.actionDone')}
              </span>{' '}
              · {booking.provider.name.replace(' (demo)', '')} ·{' '}
              {formatDateTime(booking.slot.startsAt, locale)}
            </span>
          </button>
        </div>
      );
    }

    case 'safety':
      return (
        <div className="pl-11 animate-pop">
          <div
            role="alert"
            className="overflow-hidden rounded-2xl border-2 border-destructive/40 bg-card shadow-md"
          >
            <div className="flex items-center gap-2 bg-destructive px-4 py-2.5 text-sm font-semibold text-white">
              <AlertTriangle size={16} aria-hidden="true" />
              {t('chat.safety.title')}
              <span className="ml-auto text-[11px] font-normal opacity-80">
                {formatDateTime(item.createdAt, locale)}
              </span>
            </div>
            <div className="px-4 py-3.5 text-sm leading-6">
              <p>{item.message}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {item.resources.map((resource) => (
                  <a
                    key={resource.value}
                    href={`tel:${resource.value.replace(/\s/g, '')}`}
                    className={cn(
                      'inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-semibold transition-colors',
                      resource.value === '000'
                        ? 'bg-destructive text-white hover:bg-destructive/90'
                        : 'border border-border bg-card hover:bg-muted',
                    )}
                  >
                    <Phone size={14} aria-hidden="true" />
                    {resource.label} {resource.value}
                  </a>
                ))}
              </div>
            </div>
          </div>
        </div>
      );

    case 'handoff':
      return (
        <div className="pl-11 animate-fade-up">
          <div className="rounded-xl border border-border bg-card px-4 py-3 text-sm">
            <p className="flex items-center gap-2 font-semibold">
              <UserRound size={15} aria-hidden="true" /> {t('chat.handoff.title')}
            </p>
            <p className="mt-1 text-muted-foreground">{t('chat.handoff.body')}</p>
            <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-muted p-3 text-xs">
              {item.summary}
            </pre>
          </div>
        </div>
      );

    case 'error':
      return (
        <p role="alert" className="pl-11 text-sm text-destructive">
          {item.message}
        </p>
      );
  }
}

/** A permission card from an earlier turn: what was asked and what the member decided. */
function ConsentHistoryCard({ item }: { item: Extract<ChatItem, { kind: 'consent' }> }) {
  const { t } = useT();
  const tone =
    item.status === 'granted' ? 'success' : item.status === 'denied' ? 'neutral' : 'warning';
  const label =
    item.status === 'granted'
      ? item.scope === 'always'
        ? t('consent.grantedAlways')
        : item.scope === 'days90'
          ? t('consent.granted90')
          : t('consent.grantedOnce')
      : item.status === 'denied'
        ? t('consent.denied')
        : t('chat.consentExpired');
  return (
    <section
      aria-label={t('consent.title')}
      className={cn(
        'overflow-hidden rounded-2xl border bg-card shadow-sm',
        item.sensitive ? 'border-violet/30' : 'border-border',
      )}
    >
      <header className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold">
        <Lock
          size={15}
          className={item.sensitive ? 'text-violet' : 'text-primary'}
          aria-hidden="true"
        />
        {item.sensitive ? t('consent.sensitiveTitle') : t('consent.title')}
        <Badge tone={tone} className="ml-auto">
          {label}
        </Badge>
      </header>
      <dl className="grid gap-x-4 gap-y-1.5 border-t border-border px-4 py-3 text-sm opacity-90">
        {item.dataLabel ? (
          <div className="grid grid-cols-[112px_1fr] gap-3">
            <dt className="text-xs text-muted-foreground">{t('consent.data')}</dt>
            <dd>{item.dataLabel}</dd>
          </div>
        ) : null}
        <div className="grid grid-cols-[112px_1fr] gap-3">
          <dt className="text-xs text-muted-foreground">{t('consent.purpose')}</dt>
          <dd>{item.purpose}</dd>
        </div>
        {item.benefit ? (
          <div className="grid grid-cols-[112px_1fr] gap-3">
            <dt className="text-xs text-muted-foreground">{t('consent.benefit')}</dt>
            <dd>{item.benefit}</dd>
          </div>
        ) : null}
      </dl>
    </section>
  );
}
