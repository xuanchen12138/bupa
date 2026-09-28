import { BookMarked, CalendarClock, Gauge, Info } from 'lucide-react';
import type { Cover } from '@bupa/contracts';
import { Badge } from '@/components/ui/primitives';
import { useT } from '@/i18n';
import { formatMoneyRange, formatRelativeDays } from '@/lib/format';
import { cn } from '@/lib/utils';

const statusTone = {
  included: 'success',
  partial: 'warning',
  excluded: 'danger',
  needs_confirmation: 'neutral',
} as const;

export function CoverStatusBadge({ status }: { status: Cover['status'] }) {
  const { t } = useT();
  return <Badge tone={statusTone[status]}>{t(`cover.${status}`)}</Badge>;
}

export function CoverCard({
  cover,
  expanded,
  className,
}: {
  cover: Cover;
  expanded?: boolean;
  className?: string;
}) {
  const { t, tx, locale } = useT();
  const cost = formatMoneyRange(
    cover.outOfPocket,
    locale,
    t('common.free'),
    t('common.unknownCost'),
  );
  return (
    <div className={cn('rounded-xl border border-border bg-card', className)}>
      <div className="flex items-start justify-between gap-4 px-4 pt-4">
        <div>
          <p className="text-sm font-semibold">{t(`service.${cover.service}`)}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{t('dash.outOfPocket')}</p>
        </div>
        <div className="text-right">
          <CoverStatusBadge status={cover.status} />
          <p
            className={cn(
              'mt-1 text-base font-semibold tabular-nums',
              cover.outOfPocket?.max === 0 && 'text-success',
            )}
          >
            {cost}
          </p>
        </div>
      </div>
      {cover.summary ? <p className="px-4 pt-3 text-sm leading-6">{tx(cover.summary)}</p> : null}
      {(cover.waitingPeriod || cover.limit) && (
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 px-4 text-xs text-muted-foreground">
          {cover.waitingPeriod ? (
            <span className="inline-flex items-center gap-1.5">
              <CalendarClock size={13} aria-hidden="true" />
              {cover.waitingPeriod.served
                ? t('cover.waitingServed')
                : `${t('cover.waitingUntil')} ${cover.waitingPeriod.endsAt} (${formatRelativeDays(cover.waitingPeriod.endsAt, locale)})`}
            </span>
          ) : null}
          {cover.limit ? (
            <span className="inline-flex items-center gap-1.5">
              <Gauge size={13} aria-hidden="true" />
              {t('cover.limit')} A${cover.limit.total} · {t('cover.used')} A${cover.limit.used} ·{' '}
              {t('cover.resets')} {cover.limit.resetsAt}
            </span>
          ) : null}
        </div>
      )}
      {cover.limit ? (
        <div className="mx-4 mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary"
            style={{ width: `${Math.min(100, (cover.limit.used / cover.limit.total) * 100)}%` }}
          />
        </div>
      ) : null}
      <div
        className={cn(
          'mt-3 space-y-1 border-t border-border px-4 py-3 text-xs text-muted-foreground',
          !expanded && 'py-2.5',
        )}
      >
        <p className="flex items-center gap-1.5">
          <BookMarked size={12} aria-hidden="true" />
          <span className="font-medium">{t('cover.source')}:</span> {cover.sourceLabel}
        </p>
        {expanded ? (
          <p className="flex items-center gap-1.5">
            <Info size={12} aria-hidden="true" />
            {cover.disclaimer}
          </p>
        ) : null}
      </div>
    </div>
  );
}
