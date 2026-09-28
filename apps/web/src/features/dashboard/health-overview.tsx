import {
  AlertTriangle,
  ExternalLink,
  HeartPulse,
  Loader2,
  MessageSquareText,
  PencilLine,
  ShieldCheck,
} from 'lucide-react';
import type { UseQueryResult } from '@tanstack/react-query';
import type { HealthFact, HealthOverviewResponse } from '@bupa/contracts';
import { Button } from '@/components/ui/button';
import { Badge, Card, Skeleton } from '@/components/ui/primitives';
import { toast } from '@/components/ui/toast';
import { useT } from '@/i18n';
import { api } from '@/lib/api';
import { formatDate, formatDateTime } from '@/lib/format';
import { invalidateAll } from '@/lib/query';
import { cn } from '@/lib/utils';
import { useNavigation } from '@/stores/navigation';
import { useSuggestionActions } from './use-suggestion-actions';

/**
 * Top of the Dashboard: what the member told us, organised, with a link to every source.
 * Renders every service status explicitly; an empty, disabled or failed overview never shows a
 * sample item in its place.
 */
export function HealthOverview({
  query,
  presetByDemo,
}: {
  query: UseQueryResult<HealthOverviewResponse>;
  presetByDemo: boolean;
}) {
  const { t, tx, locale } = useT();
  const navigate = useNavigation((s) => s.navigate);
  const { viewSource, updateStatus } = useSuggestionActions();
  const overview = query.data;

  const enable = async () => {
    await api.setPersonalization({ enabled: true });
    invalidateAll();
    toast({ title: t('personal.enabledToast'), tone: 'success' });
  };

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
            <HeartPulse size={18} aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-lg font-semibold tracking-tight">{t('health.title')}</h2>
            <p className="text-sm text-muted-foreground">{t('health.subtitle')}</p>
          </div>
        </div>
        {overview ? (
          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-subtle">
            <Badge tone="neutral">{t(`health.data.${overview.dataMode}`)}</Badge>
            <Badge tone="neutral">{t(`health.mode.${overview.generationMode}`)}</Badge>
            {overview.generatedAt ? (
              <span className="ml-1">
                {t('health.updated')} {formatDateTime(overview.generatedAt, locale)}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="px-5 py-4">
        {!api.features.personalization ? (
          <p className="text-sm text-muted-foreground">{t('health.unavailable')}</p>
        ) : query.isLoading || !overview ? (
          <div className="space-y-3">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-20" />
          </div>
        ) : query.isError ? (
          <ErrorState message={query.error.message} onRetry={() => void query.refetch()} />
        ) : overview.status === 'disabled' ? (
          <div className="flex flex-wrap items-center gap-4">
            <ShieldCheck size={20} className="shrink-0 text-subtle" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{t('health.disabled.title')}</p>
              <p className="mt-0.5 text-sm leading-6 text-muted-foreground">
                {t('health.disabled.body')}
              </p>
            </div>
            <Button size="sm" onClick={() => void enable()}>
              {t('health.disabled.action')}
            </Button>
          </div>
        ) : overview.status === 'error' ? (
          <ErrorState
            message={overview.error?.message ?? t('health.error.title')}
            onRetry={() => void api.refreshHealthOverview().then(() => query.refetch())}
          />
        ) : overview.status === 'empty' ? (
          <div className="flex flex-wrap items-center gap-4">
            <MessageSquareText size={20} className="shrink-0 text-subtle" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{t('health.empty.title')}</p>
              <p className="mt-0.5 text-sm leading-6 text-muted-foreground">
                {t('health.empty.body')}
              </p>
            </div>
            <Button size="sm" variant="soft" onClick={() => navigate('chat')}>
              {t('health.empty.action')}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {overview.status === 'pending' ? (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 size={13} className="animate-spin" aria-hidden="true" />{' '}
                {t('health.pending')}
              </p>
            ) : null}
            {overview.summary ? (
              <p className="text-[15px] leading-7">{tx(overview.summary)}</p>
            ) : null}
            <ul className="grid gap-3 md:grid-cols-2">
              {overview.facts.map((fact) => (
                <FactCard
                  key={fact.id}
                  fact={fact}
                  onSource={() => viewSource(fact.sources[0]!)}
                  onUpdate={() => void updateStatus(fact.sources)}
                />
              ))}
            </ul>
          </div>
        )}
        {presetByDemo && overview && overview.status !== 'disabled' ? (
          <p className="mt-4 flex items-start gap-1.5 text-[11px] leading-4 text-subtle">
            <ShieldCheck size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
            {t('health.presetNote')}
          </p>
        ) : null}
      </div>
    </Card>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useT();
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl bg-destructive-soft px-4 py-3 text-sm text-destructive">
      <AlertTriangle size={16} aria-hidden="true" />
      <span className="flex-1">
        <span className="font-semibold">{t('health.error.title')}</span> · {message}
      </span>
      <Button size="sm" variant="outline" onClick={onRetry}>
        {t('common.retry')}
      </Button>
    </div>
  );
}

const stateTone: Record<HealthFact['state'], 'warning' | 'primary' | 'success' | 'neutral'> = {
  unknown: 'warning',
  reported_ongoing: 'primary',
  reported_improving: 'primary',
  reported_resolved: 'success',
};

function FactCard({
  fact,
  onSource,
  onUpdate,
}: {
  fact: HealthFact;
  onSource: () => void;
  onUpdate: () => void;
}) {
  const { t, tx, locale } = useT();
  const first = fact.sources[0]!;
  const last = fact.sources.at(-1)!;
  return (
    <li className="rounded-xl border border-border bg-background/60 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-semibold">{tx(fact.title)}</p>
        <Badge tone={stateTone[fact.state]}>{t(`health.state.${fact.state}`)}</Badge>
        <Badge tone="neutral" className="font-medium">
          {t('health.userReported')}
        </Badge>
      </div>
      <p className="mt-2 text-sm leading-6">{tx(fact.summary)}</p>
      <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
        <div className="flex gap-1.5">
          <dt>{t('health.reportedAt')}</dt>
          <dd className="font-medium text-foreground/80">{formatDate(first.reportedAt, locale)}</dd>
        </div>
        {last.messageId !== first.messageId ? (
          <div className="flex gap-1.5">
            <dt>{t('health.lastUpdate')}</dt>
            <dd className="font-medium text-foreground/80">
              {formatDate(last.reportedAt, locale)}
            </dd>
          </div>
        ) : null}
      </dl>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={onSource}>
          <ExternalLink size={13} aria-hidden="true" /> {t('health.viewSource')}
        </Button>
        {fact.state !== 'reported_resolved' ? (
          <Button size="sm" variant="soft" onClick={onUpdate}>
            <PencilLine size={13} aria-hidden="true" /> {t('health.updateStatus')}
          </Button>
        ) : null}
      </div>
      <span className={cn('sr-only')}>{fact.topicKey}</span>
    </li>
  );
}
