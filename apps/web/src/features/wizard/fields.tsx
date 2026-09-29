import { Lock, Sparkles } from 'lucide-react';
import { useEffect, useState, type ChangeEvent, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import type {
  ConsentDecision,
  ConsentRequest,
  ProfileFieldName,
  WizardDraft,
  WizardFieldValue,
} from '@bupa/contracts';
import type { WizardFieldDefinition } from '@bupa/contracts/wizard';
import { ConsentCard } from '@/components/consent-card';
import { Button } from '@/components/ui/button';
import { FieldLabel, Input, Select, SourceTag, Switch, Textarea } from '@/components/ui/primitives';
import { useT, type Locale } from '@/i18n';
import { api } from '@/lib/api';
import { keys, invalidateAll } from '@/lib/query';
import { cn } from '@/lib/utils';
import { stringOf, useHighlight } from './use-draft';

type Copy = {
  data: string;
  purpose: string;
  benefit: string;
  excluded: string[];
  retention: string;
};
const consentCopy: Partial<Record<ProfileFieldName, Record<Locale, Copy>>> = {
  preferredLanguage: {
    en: {
      data: 'Preferred language (from your profile)',
      purpose: 'Prefer clinics that speak your language and note it on the booking',
      benefit: 'A doctor you can talk to comfortably',
      excluded: ['Pricing or renewal', 'Claims assessment', 'Marketing'],
      retention: 'This time: this booking only · Always: until you withdraw it',
    },
    zh: {
      data: '首选语言（来自你的 Profile）',
      purpose: '优先推荐会说你语言的诊所，并写在预约里',
      benefit: '一位你能顺畅沟通的医生',
      excluded: ['定价或续保', '理赔审核', '营销'],
      retention: '仅本次：只用于这次预约 · 始终允许：直到你撤回',
    },
  },
  interpreter: {
    en: {
      data: 'Interpreter preference (from your profile)',
      purpose: 'Ask the clinic to arrange an interpreter for this visit',
      benefit: 'Free phone interpreting ready when you arrive',
      excluded: ['Pricing or renewal', 'Claims assessment', 'Marketing'],
      retention: 'This time: this booking only · Always: until you withdraw it',
    },
    zh: {
      data: '口译偏好（来自你的 Profile）',
      purpose: '请诊所为这次就诊安排口译',
      benefit: '到诊时免费电话口译已准备好',
      excluded: ['定价或续保', '理赔审核', '营销'],
      retention: '仅本次：只用于这次预约 · 始终允许：直到你撤回',
    },
  },
  consultPreference: {
    en: {
      data: 'Visit preference: video or in person (from your profile)',
      purpose: 'Offer faster video options when you are happy with them',
      benefit: 'Sooner appointments without extra questions',
      excluded: ['Pricing or renewal', 'Claims assessment', 'Marketing'],
      retention: 'This time: this booking only · Always: until you withdraw it',
    },
    zh: {
      data: '就诊方式偏好：视频或面诊（来自你的 Profile）',
      purpose: '在你接受的情况下优先提供更快的视频问诊',
      benefit: '更早的就诊时间，不用反复确认',
      excluded: ['定价或续保', '理赔审核', '营销'],
      retention: '仅本次：只用于这次预约 · 始终允许：直到你撤回',
    },
  },
};

export function FieldShell({
  def,
  draft,
  invalid,
  children,
  trailing,
}: {
  def: WizardFieldDefinition;
  draft: WizardDraft;
  invalid: boolean;
  children: ReactNode;
  trailing?: ReactNode;
}) {
  const { t, tx } = useT();
  const highlighted = useHighlight(def.id);
  const field = draft.fields[def.id];
  const hasValue = field && field.value !== null && field.value !== '';
  return (
    <div className={cn('rounded-lg p-1 -m-1', highlighted && 'field-changed')} data-field={def.id}>
      <FieldLabel
        htmlFor={`field-${def.id}`}
        required={def.required}
        trailing={
          <span className="flex items-center gap-2">
            {trailing}
            {hasValue && field?.source ? <SourceTag source={field.source} /> : null}
          </span>
        }
      >
        {tx(def.label)}
      </FieldLabel>
      {children}
      {def.hint ? (
        <p className="mt-1.5 text-xs leading-5 text-muted-foreground">{tx(def.hint)}</p>
      ) : null}
      {invalid ? (
        <p role="alert" className="mt-1.5 text-xs font-medium text-destructive">
          {t('common.required')}
        </p>
      ) : null}
    </div>
  );
}

/** Inline permission request shown next to a profile-backed field that the AI is not allowed to use. */
export function InlineConsent({ def }: { def: WizardFieldDefinition }) {
  const { t, locale } = useT();
  const [request, setRequest] = useState<ConsentRequest | null>(null);
  const [decision, setDecision] = useState<ConsentDecision | null>(null);
  const [busy, setBusy] = useState(false);
  const field = def.consent ?? def.profileField;
  const copy = field ? consentCopy[field]?.[locale] : undefined;
  if (!field || !copy) return null;

  const ask = async () => {
    setBusy(true);
    const created = await api.requestConsent({
      fields: [field],
      sensitive: false,
      dataLabel: copy.data,
      purpose: copy.purpose,
      benefit: copy.benefit,
      excludedUses: copy.excluded,
      retention: copy.retention,
      allowedScopes: ['session', 'days90', 'always'],
      wizardFieldId: def.id,
    });
    setRequest(created);
    setBusy(false);
  };
  const decide = async (choice: ConsentDecision) => {
    if (!request) return;
    setBusy(true);
    setDecision(choice);
    await api.respondConsent(request.id, choice);
    invalidateAll();
    setBusy(false);
  };

  if (request) {
    return (
      <ConsentCard
        compact
        className="mt-2"
        request={request}
        decision={decision}
        onDecide={(d) => void decide(d)}
        busy={busy}
      />
    );
  }
  return (
    <div className="mt-2 flex items-center gap-3 rounded-lg border border-dashed border-primary/40 bg-primary-soft/40 px-3 py-2 text-xs">
      <Lock size={14} className="shrink-0 text-primary" aria-hidden="true" />
      <span className="text-muted-foreground">{t('wizard.needsConsent')}</span>
      <Button
        size="sm"
        variant="soft"
        className="ml-auto h-7"
        disabled={busy}
        onClick={() => void ask()}
      >
        <Sparkles size={12} aria-hidden="true" /> {t('wizard.askConsent')}
      </Button>
    </div>
  );
}

function useProfilePermission(field?: ProfileFieldName) {
  const profile = useQuery({ queryKey: keys.profile, queryFn: api.profile });
  if (!field || !profile.data) return 'off';
  return profile.data.member.fields[field].permission;
}

/** Text-like inputs keep local state and commit on blur so the server round-trip never fights the cursor. */
export function TextField({
  def,
  draft,
  onCommit,
  invalid,
}: {
  def: WizardFieldDefinition;
  draft: WizardDraft;
  onCommit: (value: WizardFieldValue) => void;
  invalid: boolean;
}) {
  const { tx } = useT();
  const serverValue = stringOf(draft, def.id);
  const [value, setValue] = useState(serverValue);
  useEffect(() => setValue(serverValue), [serverValue]);
  const permission = useProfilePermission(def.consent ?? def.profileField);
  const showConsent = (def.consent ?? def.profileField) && permission === 'off' && !serverValue;
  const commit = () => {
    if (value !== serverValue) onCommit(value === '' ? null : value);
  };
  const shared = {
    id: `field-${def.id}`,
    value,
    placeholder: def.placeholder ? tx(def.placeholder) : undefined,
    'aria-invalid': invalid || undefined,
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setValue(event.target.value),
    onBlur: commit,
  };
  return (
    <FieldShell def={def} draft={draft} invalid={invalid}>
      {def.type === 'textarea' ? (
        <Textarea {...shared} rows={3} />
      ) : (
        <Input {...shared} inputMode={def.type === 'postcode' ? 'numeric' : undefined} />
      )}
      {showConsent ? <InlineConsent def={def} /> : null}
    </FieldShell>
  );
}

export function SelectField({
  def,
  draft,
  onCommit,
  invalid,
}: {
  def: WizardFieldDefinition;
  draft: WizardDraft;
  onCommit: (value: WizardFieldValue) => void;
  invalid: boolean;
}) {
  const { tx } = useT();
  const value = stringOf(draft, def.id);
  const permission = useProfilePermission(def.consent ?? def.profileField);
  const showConsent = (def.consent ?? def.profileField) && permission === 'off' && !value;
  return (
    <FieldShell def={def} draft={draft} invalid={invalid}>
      <Select
        id={`field-${def.id}`}
        value={value}
        aria-invalid={invalid || undefined}
        onChange={(event) => onCommit(event.target.value || null)}
      >
        <option value="">—</option>
        {def.options?.map((option) => (
          <option key={option.value} value={option.value}>
            {tx(option.label)}
          </option>
        ))}
      </Select>
      {showConsent ? <InlineConsent def={def} /> : null}
    </FieldShell>
  );
}

/** Large-tile radio group for the service type. */
export function ServiceField({
  def,
  draft,
  onCommit,
  invalid,
}: {
  def: WizardFieldDefinition;
  draft: WizardDraft;
  onCommit: (value: WizardFieldValue) => void;
  invalid: boolean;
}) {
  const { tx } = useT();
  const value = stringOf(draft, def.id);
  return (
    <FieldShell def={def} draft={draft} invalid={invalid}>
      <div role="radiogroup" className="grid grid-cols-2 gap-2">
        {def.options?.map((option) => {
          const active = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onCommit(option.value)}
              className={cn(
                'rounded-xl border p-3 text-left transition-all',
                active
                  ? 'border-primary bg-primary-soft/60 shadow-[inset_0_0_0_1px_var(--primary)]'
                  : 'border-border bg-card hover:border-border-strong hover:bg-muted/40',
              )}
            >
              <p className="text-sm font-semibold">{tx(option.label)}</p>
              {option.description ? (
                <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                  {tx(option.description)}
                </p>
              ) : null}
            </button>
          );
        })}
      </div>
    </FieldShell>
  );
}

export function BooleanField({
  def,
  draft,
  onCommit,
}: {
  def: WizardFieldDefinition;
  draft: WizardDraft;
  onCommit: (value: WizardFieldValue) => void;
}) {
  const { tx } = useT();
  const highlighted = useHighlight(def.id);
  const field = draft.fields[def.id];
  const checked = field?.value === true;
  const permission = useProfilePermission(def.consent ?? def.profileField);
  const showConsent =
    (def.consent ?? def.profileField) &&
    permission === 'off' &&
    field?.source !== 'user' &&
    field?.value === null;
  return (
    <div className={cn('rounded-lg p-1 -m-1', highlighted && 'field-changed')} data-field={def.id}>
      <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-card px-3.5 py-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">{tx(def.label)}</p>
          {def.hint ? (
            <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{tx(def.hint)}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {field && field.value !== null && field.source !== 'user' ? (
            <SourceTag source={field.source} />
          ) : null}
          <Switch
            checked={checked}
            onCheckedChange={(next) => onCommit(next)}
            label={tx(def.label)}
          />
        </div>
      </div>
      {showConsent ? <InlineConsent def={def} /> : null}
    </div>
  );
}

export function ListField({ def, draft }: { def: WizardFieldDefinition; draft: WizardDraft }) {
  const items = stringOf(draft, def.id)
    .split('·')
    .map((s) => s.trim())
    .filter(Boolean);
  return (
    <FieldShell def={def} draft={draft} invalid={false}>
      <ul className="grid gap-1.5 rounded-xl border border-border bg-card p-3.5 text-sm">
        {items.map((item) => (
          <li key={item} className="flex items-start gap-2">
            <span
              aria-hidden="true"
              className="mt-[7px] size-1.5 shrink-0 rounded-full bg-primary"
            />
            {item}
          </li>
        ))}
      </ul>
    </FieldShell>
  );
}
