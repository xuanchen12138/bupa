import { Building2, Clock, Info, Languages, MapPin, Video } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import type { Provider, WizardDraft, WizardFieldValue } from '@bupa/contracts';
import type { WizardFieldDefinition } from '@bupa/contracts/wizard';
import { Badge, Skeleton, SourceTag } from '@/components/ui/primitives';
import { useT } from '@/i18n';
import { api } from '@/lib/api';
import { formatDayLabel, formatMoneyRange, formatTime, languageName } from '@/lib/format';
import { keys } from '@/lib/query';
import { cn } from '@/lib/utils';
import { stringOf, useHighlight } from './use-draft';

export function ProviderField({
  def,
  slotDef,
  draft,
  onCommit,
  invalidProvider,
  invalidSlot,
}: {
  def: WizardFieldDefinition;
  slotDef: WizardFieldDefinition;
  draft: WizardDraft;
  onCommit: (id: string, value: WizardFieldValue) => void;
  invalidProvider: boolean;
  invalidSlot: boolean;
}) {
  const { t, tx, locale } = useT();
  const highlightedProvider = useHighlight(def.id);
  const highlightedSlot = useHighlight(slotDef.id);
  const service = stringOf(draft, 'serviceType') || 'gp';
  const postcode = stringOf(draft, 'postcode') || null;
  const language = stringOf(draft, 'language') || null;
  const acceptTelehealth = draft.fields.acceptTelehealth?.value === true;
  const providers = useQuery({
    queryKey: keys.providers(service, postcode, language),
    queryFn: () =>
      api.findProviders({
        service: service as Provider['service'],
        postcode,
        language,
        telehealthOnly: false,
      }),
  });
  const selectedId = stringOf(draft, 'providerId');
  const selectedSlot = stringOf(draft, 'slotId');
  const providerField = draft.fields.providerId;
  const selected = providers.data?.providers.find((p) => p.id === selectedId);
  const noPostcode = !postcode && service !== 'telehealth';

  return (
    <div className="space-y-5">
      <div
        className={cn('rounded-lg p-1 -m-1', highlightedProvider && 'field-changed')}
        data-field={def.id}
      >
        <div className="mb-2 flex items-center justify-between gap-3">
          <p className="text-sm font-medium">
            {tx(def.label)}
            <span className="ml-0.5 text-destructive" aria-hidden="true">
              *
            </span>
          </p>
          {providerField && providerField.value && providerField.source !== 'user' ? (
            <SourceTag source={providerField.source} />
          ) : null}
        </div>
        {noPostcode ? (
          <p className="mb-2 flex items-center gap-1.5 text-xs text-warning">
            <Info size={13} aria-hidden="true" /> {t('wizard.noPostcode')}
          </p>
        ) : null}
        {providers.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
          </div>
        ) : (
          <div
            role="radiogroup"
            aria-label={tx(def.label)}
            className={cn('space-y-2', invalidProvider && 'rounded-xl ring-2 ring-destructive/40')}
          >
            {providers.data?.providers
              .filter(
                (p) => acceptTelehealth || service === 'telehealth' || !p.telehealth || noPostcode,
              )
              .map((provider, index) => {
                const active = provider.id === selectedId;
                const earliest = provider.slots[0];
                return (
                  <button
                    key={provider.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => onCommit('providerId', provider.id)}
                    className={cn(
                      'w-full rounded-xl border p-3.5 text-left transition-all',
                      active
                        ? 'border-primary bg-primary-soft/50 shadow-[inset_0_0_0_1px_var(--primary)]'
                        : 'border-border bg-card hover:border-border-strong hover:shadow-sm',
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
                          <p className="text-sm font-semibold">
                            {provider.name.replace(' (demo)', '')}
                          </p>
                          {index === 0 ? (
                            <Badge tone="warning">{locale === 'zh' ? '最推荐' : 'Top pick'}</Badge>
                          ) : null}
                          <Badge
                            tone={provider.relationship === 'bupa_owned' ? 'primary' : 'neutral'}
                          >
                            {t(`relationship.${provider.relationship}`)}
                          </Badge>
                        </div>
                        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          <span className="inline-flex items-center gap-1">
                            <MapPin size={12} aria-hidden="true" />
                            {provider.distanceKm !== null
                              ? `${provider.distanceKm} ${t('common.km')}`
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
                            {provider.languages
                              .map((code) => languageName(code, locale))
                              .join(' · ')}
                          </span>
                        </div>
                        <div className="mt-2 flex items-center justify-between gap-3">
                          <p className="text-xs leading-5 text-foreground/80">
                            <span className="font-semibold text-primary-strong">
                              {t('wizard.why')}:{' '}
                            </span>
                            {tx(provider.reason)}
                          </p>
                          <span
                            className={cn(
                              'shrink-0 text-sm font-semibold',
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
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
          </div>
        )}
        {providers.data && providers.data.providers.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border px-4 py-5 text-center text-xs text-muted-foreground">
            {t('wizard.noProviders')}
          </p>
        ) : null}
        {providers.data ? (
          <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-4 text-subtle">
            <Info size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>
              <span className="font-semibold">{t('wizard.rankingNote')}: </span>
              {tx(providers.data.rankingNote)}
            </span>
          </p>
        ) : null}
        {invalidProvider ? (
          <p role="alert" className="mt-1.5 text-xs font-medium text-destructive">
            {t('common.required')}
          </p>
        ) : null}
      </div>

      {selected ? (
        <div
          className={cn('rounded-lg p-1 -m-1', highlightedSlot && 'field-changed')}
          data-field={slotDef.id}
        >
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="text-sm font-medium">
              {tx(slotDef.label)}
              <span className="ml-0.5 text-destructive" aria-hidden="true">
                *
              </span>
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                {t('wizard.slotsFor')} {selected.name.replace(' (demo)', '')}
              </span>
            </p>
            {draft.fields.slotId?.value && draft.fields.slotId.source !== 'user' ? (
              <SourceTag source={draft.fields.slotId.source} />
            ) : null}
          </div>
          <SlotGrid
            slots={selected.slots}
            selected={selectedSlot}
            onSelect={(id) => onCommit('slotId', id)}
            invalid={invalidSlot}
          />
          {invalidSlot ? (
            <p role="alert" className="mt-1.5 text-xs font-medium text-destructive">
              {t('common.required')}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function SlotGrid({
  slots,
  selected,
  onSelect,
  invalid,
}: {
  slots: Provider['slots'];
  selected: string;
  onSelect: (id: string) => void;
  invalid: boolean;
}) {
  const { t, locale } = useT();
  const groups = new Map<string, Provider['slots']>();
  for (const slot of slots) {
    const day = formatDayLabel(slot.startsAt, locale, t('common.today'), t('common.tomorrow'));
    groups.set(day, [...(groups.get(day) ?? []), slot]);
  }
  return (
    <div
      className={cn(
        'space-y-2.5 rounded-xl border border-border bg-card p-3.5',
        invalid && 'ring-2 ring-destructive/40',
      )}
    >
      {[...groups.entries()].map(([day, daySlots]) => (
        <div key={day} className="flex items-start gap-3">
          <p className="w-20 shrink-0 pt-1.5 text-xs font-semibold text-muted-foreground">{day}</p>
          <div className="flex flex-wrap gap-1.5">
            {daySlots.map((slot) => {
              const active = slot.id === selected;
              return (
                <button
                  key={slot.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => onSelect(slot.id)}
                  className={cn(
                    'rounded-lg border px-3 py-1.5 text-sm tabular-nums transition-all',
                    active
                      ? 'border-primary bg-primary text-white shadow-sm'
                      : 'border-border bg-card hover:border-primary/50 hover:bg-primary-soft/50',
                  )}
                >
                  {formatTime(slot.startsAt, locale)}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
