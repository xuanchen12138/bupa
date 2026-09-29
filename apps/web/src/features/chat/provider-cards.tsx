import {
  Building2,
  Check,
  Clock,
  ExternalLink,
  Languages,
  MapPin,
  Sparkles,
  Video,
  X,
} from 'lucide-react';
import { useState } from 'react';
import type { ConversationEntry } from '@bupa/contracts';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/primitives';
import { toast } from '@/components/ui/toast';
import { useT } from '@/i18n';
import { formatDayLabel, formatMoneyRange, formatTime, languageName } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useChat } from '@/stores/chat';

type ProvidersEntry = Extract<ConversationEntry, { kind: 'providers' }>;

/**
 * The assistant's top recommendations. Each card says how the clinic matches every preference
 * the member shared; picking one is what prepares the booking draft.
 */
export function ProviderCards({ item }: { item: ProvidersEntry }) {
  const { t, tx, locale } = useT();
  const choose = useChat((s) => s.chooseProvider);
  const running = useChat((s) => s.views[item.conversationId]?.running ?? false);
  const [busy, setBusy] = useState<string | null>(null);
  const { providers, matches, personalisedBy } = item.options;

  const pick = async (providerId: string) => {
    if (busy) return;
    setBusy(providerId);
    try {
      await choose(item.conversationId, item.id, providerId);
    } catch (error) {
      toast({ title: error instanceof Error ? error.message : 'Unexpected error', tone: 'info' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="pl-11 animate-fade-up">
      <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-subtle">
        <Sparkles size={12} aria-hidden="true" />
        {t('providers.title')}
        {personalisedBy.length ? (
          <span className="font-normal normal-case tracking-normal">
            · {t('wizard.personalisedBy')}:{' '}
            {personalisedBy.map((field) => t(`profile.field.${field}`)).join(' · ')}
          </span>
        ) : (
          <span className="font-normal normal-case tracking-normal">
            · {t('providers.byDistance')}
          </span>
        )}
      </p>
      <ol className="space-y-2.5">
        {providers.map((provider, index) => {
          const selected = item.selectedProviderId === provider.id;
          const dimmed = item.selectedProviderId !== null && !selected;
          const points = matches.find((m) => m.providerId === provider.id)?.points ?? [];
          const earliest = provider.slots[0];
          return (
            <li
              key={provider.id}
              className={cn(
                'rounded-2xl border bg-card p-4 shadow-sm transition-all',
                selected ? 'border-primary ring-2 ring-primary/20' : 'border-border',
                dimmed && 'opacity-60',
              )}
            >
              <div className="flex items-start gap-3">
                <div
                  className={cn(
                    'flex size-9 shrink-0 items-center justify-center rounded-lg',
                    provider.telehealth
                      ? 'bg-violet-soft text-violet'
                      : 'bg-primary-soft text-primary',
                  )}
                >
                  {provider.telehealth ? (
                    <Video size={17} aria-hidden="true" />
                  ) : (
                    <Building2 size={17} aria-hidden="true" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <p className="text-sm font-semibold">{provider.name.replace(' (demo)', '')}</p>
                    {index === 0 ? <Badge tone="warning">{t('providers.topPick')}</Badge> : null}
                    <Badge tone={provider.relationship === 'bupa_owned' ? 'primary' : 'neutral'}>
                      {t(`relationship.${provider.relationship}`)}
                    </Badge>
                    {selected ? (
                      <Badge tone="success">
                        <Check size={11} aria-hidden="true" /> {t('providers.selected')}
                      </Badge>
                    ) : null}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">{provider.address}</p>
                  <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <MapPin size={12} aria-hidden="true" />
                      {provider.distanceKm !== null
                        ? `${provider.distanceKm} ${t('common.km')}${
                            provider.travelMinutes != null
                              ? ` · ≈${provider.travelMinutes} ${t('wizard.travel')}`
                              : ''
                          }`
                        : t('common.online')}
                    </span>
                    {earliest ? (
                      <span className="inline-flex items-center gap-1">
                        <Clock size={12} aria-hidden="true" />
                        {t('wizard.earliest')}{' '}
                        {formatDayLabel(
                          earliest.startsAt,
                          locale,
                          t('common.today'),
                          t('common.tomorrow'),
                        )}{' '}
                        {formatTime(earliest.startsAt, locale)}
                      </span>
                    ) : null}
                    <span className="inline-flex items-center gap-1">
                      <Languages size={12} aria-hidden="true" />
                      {provider.languages.map((code) => languageName(code, locale)).join(' · ')}
                    </span>
                    {provider.website ? (
                      <a
                        href={provider.website}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-primary hover:underline"
                      >
                        <ExternalLink size={12} aria-hidden="true" /> {t('providers.website')}
                      </a>
                    ) : null}
                  </div>

                  {points.length ? (
                    <ul className="mt-2.5 space-y-1 rounded-lg bg-background/70 px-3 py-2 text-xs">
                      {points.map((point, i) => (
                        <li key={i} className="flex items-start gap-2">
                          {point.ok ? (
                            <Check
                              size={13}
                              strokeWidth={3}
                              className="mt-0.5 shrink-0 text-success"
                              aria-hidden="true"
                            />
                          ) : (
                            <X
                              size={13}
                              strokeWidth={3}
                              className="mt-0.5 shrink-0 text-warning"
                              aria-hidden="true"
                            />
                          )}
                          <span className={point.ok ? '' : 'text-muted-foreground'}>
                            {tx(point.text)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-2 text-xs leading-5 text-foreground/80">
                      <span className="font-semibold text-primary-strong">{t('wizard.why')}: </span>
                      {tx(provider.reason)}
                    </p>
                  )}

                  <div className="mt-3 flex items-center justify-between gap-3">
                    <span
                      className={cn(
                        'text-sm font-semibold',
                        provider.outOfPocket?.max === 0 ? 'text-success' : '',
                      )}
                    >
                      {formatMoneyRange(
                        provider.outOfPocket,
                        locale,
                        t('common.free'),
                        t('common.unknownCost'),
                      )}
                    </span>
                    {selected ? null : (
                      <Button
                        size="sm"
                        variant={
                          index === 0 && item.selectedProviderId === null ? 'default' : 'soft'
                        }
                        disabled={busy !== null || running}
                        onClick={() => void pick(provider.id)}
                      >
                        {busy === provider.id ? t('suggest.starting') : t('providers.choose')}
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
