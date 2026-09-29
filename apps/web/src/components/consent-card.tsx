import { Check, Database, Gift, ShieldCheck, Target, X } from 'lucide-react';
import type { ConsentDecision, ConsentRequest } from '@bupa/contracts';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/primitives';
import { useT } from '@/i18n';
import { cn } from '@/lib/utils';

export function ConsentCard({
  request,
  decision,
  onDecide,
  busy,
  compact,
  className,
}: {
  request: ConsentRequest;
  decision: ConsentDecision | null;
  onDecide: (decision: ConsentDecision) => void;
  busy?: boolean;
  compact?: boolean;
  className?: string;
}) {
  const { t } = useT();
  const decided = decision !== null;
  const sensitive = request.sensitive;
  // Three things the member needs to decide: what, why, and what they get in return.
  const rows: Array<{ icon: typeof Database; label: string; value: string; tone?: 'muted' }> = [
    { icon: Database, label: t('consent.data'), value: request.dataLabel },
    { icon: Target, label: t('consent.purpose'), value: request.purpose },
    { icon: Gift, label: t('consent.benefit'), value: request.benefit },
  ];

  return (
    <section
      aria-label={t('consent.title')}
      className={cn(
        'animate-pop overflow-hidden rounded-2xl border bg-card shadow-md transition-shadow',
        sensitive ? 'border-violet/30' : 'border-primary/25',
        decided && 'shadow-sm',
        className,
      )}
    >
      <header
        className={cn(
          'flex items-center gap-3 px-4 py-3',
          sensitive ? 'bg-violet-soft/70 text-violet' : 'bg-primary-soft/70 text-primary-strong',
        )}
      >
        <ShieldCheck size={18} aria-hidden="true" />
        <p className="text-sm font-semibold">
          {sensitive ? t('consent.sensitiveTitle') : t('consent.title')}
        </p>
        {decided ? (
          <Badge tone={decision === 'deny' ? 'neutral' : 'success'} className="ml-auto">
            {decision === 'deny' ? (
              <X size={12} aria-hidden="true" />
            ) : (
              <Check size={12} aria-hidden="true" />
            )}
            {decision === 'deny'
              ? t('consent.denied')
              : decision === 'always'
                ? t('consent.grantedAlways')
                : decision === 'days90'
                  ? t('consent.granted90')
                  : t('consent.grantedOnce')}
          </Badge>
        ) : (
          <Badge tone="warning" className="ml-auto animate-pulse-soft">
            {t('consent.pending')}
          </Badge>
        )}
      </header>

      <dl
        className={cn(
          'grid gap-x-4 gap-y-2.5 px-4',
          compact ? 'py-3' : 'py-4',
          decided && 'opacity-80',
        )}
      >
        {rows.map(({ icon: Icon, label, value, tone }) => (
          <div key={label} className="grid grid-cols-[112px_1fr] items-start gap-3 text-sm">
            <dt className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Icon size={13} aria-hidden="true" />
              {label}
            </dt>
            <dd
              className={cn(
                'leading-5',
                tone === 'muted' ? 'text-muted-foreground' : 'text-foreground',
              )}
            >
              {value}
            </dd>
          </div>
        ))}
      </dl>

      {decided ? (
        <p className="border-t border-border px-4 py-2.5 text-xs text-muted-foreground">
          {t('consent.revokeHint')}
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-2 border-t border-border bg-background/60 px-4 py-3">
          <Button size="sm" disabled={busy} onClick={() => onDecide('session')}>
            {t('consent.allowOnce')}
          </Button>
          {request.allowedScopes.includes('days90') ? (
            <Button size="sm" variant="soft" disabled={busy} onClick={() => onDecide('days90')}>
              {t('consent.share90')}
            </Button>
          ) : null}
          {request.allowedScopes.includes('always') ? (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => onDecide('always')}>
              {t('consent.allowAlways')}
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => onDecide('deny')}
            className="ml-auto"
          >
            {t('consent.deny')}
          </Button>
        </div>
      )}
    </section>
  );
}
