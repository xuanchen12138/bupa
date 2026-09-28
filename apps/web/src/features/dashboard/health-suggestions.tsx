import {
  ArrowRight,
  CalendarCheck2,
  CalendarPlus,
  ExternalLink,
  Loader2,
  PencilLine,
  RotateCcw,
  Sparkles,
} from 'lucide-react';
import type { HealthOverviewResponse, HealthSuggestion } from '@bupa/contracts';
import { Button } from '@/components/ui/button';
import { Badge, Card } from '@/components/ui/primitives';
import { useT } from '@/i18n';
import { cn } from '@/lib/utils';
import { useSuggestionActions } from './use-suggestion-actions';

/**
 * Suggestions tied to health items, each with its reason and source. Nothing here books
 * anything: "prepare" opens the existing wizard in a dedicated conversation; the member submits.
 */
export function HealthSuggestions({ overview }: { overview: HealthOverviewResponse }) {
  const { t } = useT();
  const actions = useSuggestionActions();
  const visible = overview.suggestions.filter((s) => s.state !== 'dismissed').slice(0, 3);
  const dismissed = overview.suggestions.filter((s) => s.state === 'dismissed').length;
  if (overview.status !== 'ready' && overview.status !== 'pending') return null;

  return (
    <section aria-label={t('suggest.title')}>
      <p className="mb-2.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-subtle">
        <Sparkles size={12} aria-hidden="true" /> {t('suggest.title')}
      </p>
      {visible.length ? (
        <div className="grid gap-3 md:grid-cols-2">
          {visible.map((suggestion) => (
            <SuggestionCard
              key={suggestion.id}
              suggestion={suggestion}
              overview={overview}
              actions={actions}
            />
          ))}
        </div>
      ) : (
        <p className="rounded-xl border border-dashed border-border px-4 py-4 text-sm text-muted-foreground">
          {t('suggest.nothing')}
        </p>
      )}
      {dismissed ? (
        <p className="mt-2 text-[11px] text-subtle">
          {dismissed === 1
            ? t('suggest.dismissedOne')
            : `${dismissed} ${t('suggest.dismissedMany')}`}
        </p>
      ) : null}
    </section>
  );
}

function SuggestionCard({
  suggestion,
  overview,
  actions,
}: {
  suggestion: HealthSuggestion;
  overview: HealthOverviewResponse;
  actions: ReturnType<typeof useSuggestionActions>;
}) {
  const { t, tx } = useT();
  const busy = actions.busyId === suggestion.id;
  const isBooking = suggestion.action === 'prepare_gp_booking';
  const source = suggestion.sourceRefs[0];

  const stateBadge =
    suggestion.state === 'booked' ? (
      <Badge tone="success">
        <CalendarCheck2 size={11} aria-hidden="true" /> {t('suggest.booked')}
      </Badge>
    ) : suggestion.state === 'in_progress' ? (
      <Badge tone="primary">{t('suggest.inProgress')}</Badge>
    ) : suggestion.state === 'cancelled' ? (
      <Badge tone="neutral">{t('suggest.cancelled')}</Badge>
    ) : null;

  return (
    <Card
      className={cn(
        'relative overflow-hidden p-4 transition-shadow hover:shadow-md',
        suggestion.state === 'booked' && 'border-success/30',
      )}
    >
      <div
        className={cn(
          'absolute inset-y-0 left-0 w-1',
          isBooking ? 'bg-gradient-to-b from-primary to-violet' : 'bg-primary/60',
        )}
        aria-hidden="true"
      />
      <div className="pl-2">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-semibold leading-5">{tx(suggestion.title)}</p>
          {stateBadge}
        </div>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">{tx(suggestion.body)}</p>
        <p className="mt-2 text-xs leading-5 text-foreground/80">
          <span className="font-semibold text-primary-strong">{t('suggest.why')}: </span>
          {tx(suggestion.reason)}
          {source ? (
            <>
              {' '}
              <button
                type="button"
                onClick={() => actions.viewSource(source)}
                className="inline-flex items-center gap-1 font-semibold text-primary hover:underline"
              >
                <ExternalLink size={11} aria-hidden="true" /> {t('health.viewSource')}
              </button>
            </>
          ) : null}
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {suggestion.action === 'update_status' ? (
            <Button size="sm" onClick={() => void actions.updateStatus(suggestion.sourceRefs)}>
              <PencilLine size={13} aria-hidden="true" /> {t('suggest.update')}
            </Button>
          ) : suggestion.state === 'booked' && suggestion.bookingId ? (
            <Button
              size="sm"
              variant="soft"
              onClick={() => actions.viewBooking(suggestion.bookingId!)}
            >
              <CalendarCheck2 size={13} aria-hidden="true" /> {t('suggest.viewBooking')}
            </Button>
          ) : suggestion.state === 'in_progress' ? (
            <Button size="sm" onClick={() => void actions.continueFollowUp(suggestion)}>
              {t('suggest.continue')} <ArrowRight size={13} aria-hidden="true" />
            </Button>
          ) : (
            <Button
              size="sm"
              disabled={busy}
              onClick={() => void actions.prepareBooking(suggestion, overview)}
            >
              {busy ? (
                <Loader2 size={13} className="animate-spin" aria-hidden="true" />
              ) : suggestion.state === 'cancelled' ? (
                <RotateCcw size={13} aria-hidden="true" />
              ) : (
                <CalendarPlus size={13} aria-hidden="true" />
              )}
              {busy
                ? t('suggest.starting')
                : suggestion.state === 'cancelled'
                  ? t('suggest.prepareAgain')
                  : t('suggest.prepare')}
            </Button>
          )}
          {suggestion.state === 'available' ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => void actions.dismiss(suggestion, overview)}
              className="text-muted-foreground"
            >
              {t('suggest.dismiss')}
            </Button>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
