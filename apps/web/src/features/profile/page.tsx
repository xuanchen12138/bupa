import {
  CalendarCheck2,
  Check,
  Database,
  Lock,
  ReceiptText,
  ShieldCheck,
  Sparkles,
  Undo2,
} from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Permission, ProfileFieldName, ProfilePatch, Receipt } from '@bupa/contracts';
import { CoverCard } from '@/components/cover-card';
import { Button } from '@/components/ui/button';
import {
  Badge,
  Card,
  SectionHeading,
  Segmented,
  Select,
  Skeleton,
} from '@/components/ui/primitives';
import { toast } from '@/components/ui/toast';
import { useT, type DictionaryKey } from '@/i18n';
import { api } from '@/lib/api';
import { formatDate, formatDateTime } from '@/lib/format';
import { keys, invalidateAll } from '@/lib/query';
import { cn } from '@/lib/utils';
import { useNavigation } from '@/stores/navigation';
import { en } from '@/i18n/en';
import { PersonalizationSection } from './personalization-section';

const personalFields: ProfileFieldName[] = [
  'name',
  'dateOfBirth',
  'memberNumber',
  'phone',
  'email',
  'address',
  'emergencyContact',
  'postcode',
];
// Preferences the member sets in the product. They feed the recommendation profile only
// while the member has shared them; each row carries its own "AI use" control.
const preferenceFields: Array<{ id: ProfileFieldName; options: string[] }> = [
  { id: 'preferredTime', options: ['morning', 'afternoon', 'evening', 'any'] },
  { id: 'travelDuration', options: ['15', '30', '45', '60'] },
  { id: 'preferredLanguage', options: ['zh-CN', 'en'] },
  { id: 'consultPreference', options: ['either', 'in_person', 'video'] },
  { id: 'interpreter', options: ['yes', 'no'] },
  { id: 'reminderChannel', options: ['push', 'sms', 'email'] },
];
const completenessFields: ProfileFieldName[] = [
  'preferredTime',
  'travelDuration',
  'preferredLanguage',
  'consultPreference',
  'interpreter',
];

export function ProfilePage() {
  const { t, locale } = useT();
  const profile = useQuery({ queryKey: keys.profile, queryFn: api.profile });
  const receipts = useQuery({ queryKey: keys.receipts, queryFn: api.receipts });
  const { focusReceiptId, focusReceipt } = useNavigation();
  const dataSectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (focusReceiptId && receipts.data) {
      dataSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      const timer = setTimeout(() => focusReceipt(null), 2500);
      return () => clearTimeout(timer);
    }
  }, [focusReceiptId, receipts.data, focusReceipt]);

  const valueLabel = (raw: string) => {
    const key = `profile.value.${raw}` as DictionaryKey;
    if (!raw) return t('profile.value.empty');
    return key in en ? t(key) : raw;
  };
  const setPermission = async (field: ProfileFieldName, permission: Permission) => {
    await api.setPermission({ field, permission });
    invalidateAll();
    if (permission === 'off')
      toast({
        title: `${t(`profile.field.${field}`)} · ${t('permission.off')}`,
        body: t('consent.revokeHint'),
        tone: 'receipt',
      });
  };
  const setValue = async (field: ProfileFieldName, value: string) => {
    const fields: ProfilePatch['fields'] = {};
    fields[field] = value;
    await api.patchProfile({ fields });
    invalidateAll();
  };
  const revoke = async (receipt: Receipt) => {
    await api.revokeReceipt(receipt.id);
    invalidateAll();
    toast({ title: t('profile.revoked'), body: receipt.summary, tone: 'receipt' });
  };

  if (!profile.data) {
    return (
      <div className="mx-auto max-w-[1100px] space-y-4 px-8 py-8">
        <Skeleton className="h-10 w-1/3" />
        <Skeleton className="h-40" />
        <Skeleton className="h-64" />
      </div>
    );
  }
  const { member, covers } = profile.data;
  const fields = member.fields;
  const shared = completenessFields.filter(
    (f) => fields[f].permission !== 'off' && fields[f].value !== '',
  );

  return (
    <div className="scroll-quiet h-full overflow-y-auto">
      <div className="mx-auto max-w-[1100px] px-8 py-8">
        <div className="flex items-start justify-between gap-6">
          <div className="flex items-center gap-4">
            <div className="flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-violet text-xl font-semibold text-white shadow-md">
              {fields.name.value.slice(0, 1)}
            </div>
            <div>
              <h1 className="text-[26px] font-semibold tracking-tight">{fields.name.value}</h1>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {member.productName} · {t('profile.memberSince')} {member.memberSince} ·{' '}
                <span className="font-mono text-xs">{fields.memberNumber.value}</span>
              </p>
            </div>
          </div>
          <Badge tone="neutral" className="mt-2">
            {t('common.demoData')}
          </Badge>
        </div>
        <p className="mt-4 max-w-2xl text-sm leading-6 text-muted-foreground">
          {t('profile.subtitle')}
        </p>

        {/* ------------------------------------------------- Completeness */}
        <Card className="mt-6 p-5">
          <div className="flex items-start justify-between gap-6">
            <div>
              <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
                <Sparkles size={18} className="text-primary" aria-hidden="true" />{' '}
                {t('profile.completeness')}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">{t('profile.completenessHint')}</p>
            </div>
            <p className="text-2xl font-semibold tabular-nums">
              {shared.length}
              <span className="text-base text-muted-foreground">/{completenessFields.length}</span>
            </p>
          </div>
          <div className="mt-4 grid grid-cols-5 gap-2">
            {completenessFields.map((field) => {
              const on = shared.includes(field);
              return (
                <div
                  key={field}
                  className={cn(
                    'rounded-xl border p-3 transition-colors',
                    on ? 'border-primary/40 bg-primary-soft/50' : 'border-border bg-card',
                  )}
                >
                  <div className={cn('mb-2 h-1.5 rounded-full', on ? 'bg-primary' : 'bg-muted')} />
                  <p className="flex items-center gap-1.5 text-xs font-semibold">
                    {on ? (
                      <Check size={12} className="text-primary" aria-hidden="true" />
                    ) : (
                      <Lock size={12} className="text-subtle" aria-hidden="true" />
                    )}
                    {t(`profile.field.${field}`)}
                  </p>
                  <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
                    {t('profile.unlocks')}: {t(`profile.unlock.${field}` as DictionaryKey)}
                  </p>
                </div>
              );
            })}
          </div>
        </Card>

        {/* ------------------------------------ History & personalisation */}
        <div className="mt-6">
          <PersonalizationSection />
        </div>

        <div className="mt-6 grid grid-cols-[1fr_1fr] gap-6">
          {/* --------------------------------------------- Personal info */}
          <Card className="p-5">
            <SectionHeading
              title={t('profile.personal')}
              hint={t('profile.personalHint')}
              action={
                <Badge tone="neutral" className="shrink-0">
                  {t('profile.heldByBupa')}
                </Badge>
              }
            />
            <ul className="mt-4 divide-y divide-border">
              {personalFields.map((field) => (
                <li key={field} className="grid grid-cols-[140px_1fr] items-center gap-4 py-2.5">
                  <p className="text-xs text-muted-foreground">{t(`profile.field.${field}`)}</p>
                  <p className="truncate text-sm font-medium">
                    {fields[field].value || t('profile.value.empty')}
                  </p>
                </li>
              ))}
            </ul>
          </Card>

          {/* ----------------------------------------------- Preferences */}
          <Card className="p-5">
            <SectionHeading title={t('profile.preferences')} hint={t('profile.preferencesHint')} />
            <ul className="mt-4 divide-y divide-border">
              {preferenceFields.map(({ id, options }) => (
                <li key={id} className="grid grid-cols-[1fr_auto] items-center gap-4 py-3">
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">{t(`profile.field.${id}`)}</p>
                    <Select
                      value={fields[id].value}
                      onChange={(e) => void setValue(id, e.target.value)}
                      aria-label={t(`profile.field.${id}`)}
                      className="mt-1 h-9 py-1.5 text-sm"
                    >
                      {options.map((option) => (
                        <option key={option} value={option}>
                          {valueLabel(option)}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <PermissionControl
                    value={fields[id].permission}
                    expiresAt={fields[id].expiresAt ?? null}
                    onChange={(permission) => void setPermission(id, permission)}
                    label={t(`profile.field.${id}`)}
                  />
                </li>
              ))}
            </ul>
            <p className="mt-3 flex items-start gap-2 rounded-lg bg-muted/60 px-3 py-2.5 text-xs leading-5 text-muted-foreground">
              <ShieldCheck size={14} className="mt-0.5 shrink-0 text-primary" aria-hidden="true" />
              {t('profile.privacyNote')}
            </p>
          </Card>
        </div>

        {/* ------------------------------------------------------- Cover */}
        <section className="mt-6">
          <SectionHeading
            title={t('profile.cover')}
            hint={t('profile.coverHint')}
            className="mb-3"
          />
          <div className="grid grid-cols-3 gap-3">
            {covers.map((cover) => (
              <CoverCard key={cover.service} cover={cover} />
            ))}
          </div>
        </section>

        {/* ---------------------------------------------- Data & receipts */}
        <section ref={dataSectionRef} className="mt-6 scroll-mt-6">
          <SectionHeading title={t('profile.data')} hint={t('profile.dataHint')} className="mb-3" />
          {receipts.data?.length ? (
            <ol className="space-y-2.5">
              {receipts.data.map((receipt) => (
                <ReceiptRow
                  key={receipt.id}
                  receipt={receipt}
                  focused={receipt.id === focusReceiptId}
                  onRevoke={() => void revoke(receipt)}
                />
              ))}
            </ol>
          ) : (
            <Card className="flex items-center gap-3 px-5 py-6 text-sm text-muted-foreground">
              <ReceiptText size={18} className="text-primary" aria-hidden="true" />
              {t('profile.noReceipts')}
            </Card>
          )}
        </section>
        <p className="mt-8 text-center text-[11px] text-subtle">
          {locale === 'zh'
            ? '所有数据均为演示用途的虚构数据。'
            : 'All data shown is fictional and for demonstration only.'}
        </p>
      </div>
    </div>
  );
}

function PermissionControl({
  value,
  expiresAt,
  onChange,
  label,
}: {
  value: Permission;
  expiresAt?: string | null;
  onChange: (permission: Permission) => void;
  label: string;
}) {
  const { t, locale } = useT();
  return (
    <div className="flex flex-col items-end gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-subtle">
        {t('profile.aiUse')}
        {value === 'days90' && expiresAt
          ? ` · ${t('profile.expires')} ${formatDate(expiresAt, locale, { weekday: undefined })}`
          : ''}
      </span>
      <Segmented
        value={value}
        onChange={onChange}
        label={`${t('permission.label')} · ${label}`}
        options={[
          { value: 'off', label: t('permission.off') },
          { value: 'session', label: t('permission.session') },
          { value: 'days90', label: t('permission.days90') },
          { value: 'always', label: t('permission.always') },
        ]}
      />
    </div>
  );
}

function ReceiptRow({
  receipt,
  focused,
  onRevoke,
}: {
  receipt: Receipt;
  focused: boolean;
  onRevoke: () => void;
}) {
  const { t, locale } = useT();
  const active = receipt.status === 'active';
  const isAction = receipt.kind === 'action';
  return (
    <li
      className={cn(
        'rounded-2xl border bg-card p-4 shadow-sm transition-all',
        focused ? 'border-primary ring-4 ring-primary/15' : 'border-border',
        receipt.status === 'revoked' && 'opacity-70',
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            'flex size-9 shrink-0 items-center justify-center rounded-xl',
            isAction
              ? 'bg-success-soft text-success'
              : receipt.sensitive
                ? 'bg-violet-soft text-violet'
                : 'bg-primary-soft text-primary',
          )}
        >
          {isAction ? (
            <CalendarCheck2 size={17} aria-hidden="true" />
          ) : (
            <Database size={17} aria-hidden="true" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold">{receipt.summary}</p>
            <Badge tone={isAction ? 'success' : receipt.sensitive ? 'violet' : 'primary'}>
              {isAction
                ? t('profile.receipt.action')
                : receipt.sensitive
                  ? t('profile.receipt.sensitive')
                  : t('profile.receipt.data')}
            </Badge>
            {!isAction ? (
              <Badge tone="neutral">
                {receipt.scope === 'always'
                  ? t('permission.always')
                  : receipt.scope === 'days90'
                    ? t('permission.days90')
                    : t('permission.session')}
              </Badge>
            ) : null}
            {receipt.status === 'revoked' ? (
              <Badge tone="warning">{t('profile.revoked')}</Badge>
            ) : null}
            {receipt.status === 'cancelled' ? (
              <Badge tone="neutral">{t('dash.cancelled')}</Badge>
            ) : null}
          </div>
          <dl className="mt-2 grid grid-cols-[110px_1fr] gap-x-3 gap-y-1 text-xs">
            <dt className="text-muted-foreground">{t('consent.purpose')}</dt>
            <dd>{receipt.purpose}</dd>
            <dt className="text-muted-foreground">{t('consent.benefit')}</dt>
            <dd>{receipt.benefit}</dd>
            {receipt.excludedUses.length ? (
              <>
                <dt className="text-muted-foreground">{t('consent.excluded')}</dt>
                <dd className="text-muted-foreground">{receipt.excludedUses.join(' · ')}</dd>
              </>
            ) : null}
            <dt className="text-muted-foreground">{t('consent.retention')}</dt>
            <dd className="text-muted-foreground">{receipt.retention}</dd>
          </dl>
          <p className="mt-2 text-[11px] text-subtle">
            {formatDateTime(receipt.createdAt, locale)}
          </p>
        </div>
        {!isAction && active ? (
          <Button size="sm" variant="outline" onClick={onRevoke}>
            <Undo2 size={13} aria-hidden="true" /> {t('profile.revoke')}
          </Button>
        ) : null}
      </div>
    </li>
  );
}
