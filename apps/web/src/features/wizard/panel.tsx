import { ArrowLeft, ArrowRight, CalendarCheck2, Check, Lock, Sparkles, X } from 'lucide-react';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { WizardDraft } from '@bupa/contracts';
import { bookingWizard, type WizardFieldDefinition } from '@bupa/contracts/wizard';
import { CoverCard } from '@/components/cover-card';
import { Button } from '@/components/ui/button';
import { Badge, Skeleton, SourceTag } from '@/components/ui/primitives';
import { toast } from '@/components/ui/toast';
import { useT } from '@/i18n';
import { api, ValidationError } from '@/lib/api';
import { formatDateTime, languageName } from '@/lib/format';
import { keys } from '@/lib/query';
import { cn } from '@/lib/utils';
import { useChat } from '@/stores/chat';
import { useNavigation } from '@/stores/navigation';
import { useWizard } from '@/stores/wizard';
import { BooleanField, ListField, SelectField, ServiceField, TextField } from './fields';
import { ProviderField } from './provider-picker';
import { stepFields, stringOf, useDraft } from './use-draft';

export function WizardPanel({ draftId, onClose }: { draftId: string; onClose?: () => void }) {
  const { t, tx, locale } = useT();
  const { draft, query, patch, submit, setField, goTo } = useDraft(draftId);
  const { highlighted, invalid, completedBookingId, setCompleted, close } = useWizard();
  const notifyBooking = useChat((s) => s.notifyBooking);
  const wizardConversation = useWizard((s) => s.conversationId);
  const { navigate, focusBooking } = useNavigation();
  const [submitting, setSubmitting] = useState(false);

  const handleClose = () => {
    close();
    onClose?.();
  };

  // Submission consumes the draft; keep the success view independent of draft refetches.
  if (completedBookingId) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-8 text-center animate-pop">
        <div className="flex size-16 items-center justify-center rounded-full bg-success-soft text-success">
          <CalendarCheck2 size={30} aria-hidden="true" />
        </div>
        <h2 className="mt-5 text-xl font-semibold tracking-tight">{t('wizard.doneTitle')}</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{t('wizard.doneBody')}</p>
        <div className="mt-6 flex gap-2">
          <Button
            onClick={() => {
              focusBooking(completedBookingId);
              close();
              navigate('dashboard');
            }}
          >
            {t('wizard.viewDashboard')}
          </Button>
          <Button variant="outline" onClick={handleClose}>
            {t('wizard.closeDone')}
          </Button>
        </div>
      </div>
    );
  }

  if (query.isError) {
    return (
      <div className="p-5 text-sm text-destructive">
        {query.error.message}
        <Button variant="outline" size="sm" className="ml-3" onClick={handleClose}>
          {t('common.close')}
        </Button>
      </div>
    );
  }
  if (!draft) {
    return (
      <div className="space-y-3 p-5">
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-10" />
        <Skeleton className="h-40" />
      </div>
    );
  }

  const step = draft.step;
  const stepDef = bookingWizard.steps[step - 1]!;
  const isLast = step === bookingWizard.steps.length;
  const fields = stepFields(draft, step);

  const onSubmit = async () => {
    setSubmitting(true);
    try {
      const result = await submit.mutateAsync();
      setCompleted(result.booking.id);
      // Written back to the conversation the draft came from, not whichever chat is open now.
      notifyBooking(
        result.booking,
        result.receipt,
        result.conversationId ?? draft?.conversationId ?? wizardConversation,
      );
      toast({
        title: t('wizard.doneTitle'),
        body: `${result.booking.provider.name} · ${formatDateTime(result.booking.slot.startsAt, locale)}`,
        tone: 'success',
      });
    } catch (error) {
      if (error instanceof ValidationError) {
        // Take the member to the step that is missing something instead of a dead-end toast.
        if (error.step && error.step !== step) goTo(error.step);
        toast({ title: t('wizard.required'), tone: 'info' });
      } else {
        toast({
          title: error instanceof Error ? error.message : t('wizard.required'),
          tone: 'info',
        });
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col animate-slide-in-right">
      {/* Header */}
      <div className="border-b border-border px-5 pb-4 pt-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <p className="text-base font-semibold tracking-tight">{tx(bookingWizard.title)}</p>
            {draft.rescheduleOf ? <Badge tone="warning">{t('wizard.rescheduling')}</Badge> : null}
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClose}
              className="text-muted-foreground"
            >
              {t('wizard.leave')}
            </Button>
            <button
              type="button"
              onClick={handleClose}
              aria-label={t('common.close')}
              className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X size={16} />
            </button>
          </div>
        </div>
        <Stepper
          step={step}
          onJump={(target) => target < step && goTo(target)}
          attention={bookingWizard.fields
            .filter((f) => highlighted.includes(f.id))
            .map((f) => f.step)}
        />
      </div>

      {/* Body */}
      <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto px-5 py-5">
        <div className="mb-5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-subtle">
            {t('wizard.step')} {step} {t('wizard.of')} {bookingWizard.steps.length}
          </p>
          <h2 className="mt-1 text-lg font-semibold tracking-tight">{tx(stepDef.title)}</h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">{tx(stepDef.description)}</p>
          {step === 1 &&
          Object.values(draft.fields).some(
            (f) => f.source === 'conversation' && f.value !== null,
          ) ? (
            <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-violet-soft px-2.5 py-1 text-xs font-medium text-violet">
              <Sparkles size={12} aria-hidden="true" /> {t('wizard.prefilled')}
            </p>
          ) : null}
        </div>

        {step === 2 ? (
          <CoverStep draft={draft} />
        ) : step === 5 ? (
          <ConfirmStep draft={draft} fields={fields} setField={setField} />
        ) : (
          <div className="space-y-5">
            {step === 3 ? (
              <StepThree draft={draft} fields={fields} setField={setField} invalid={invalid} />
            ) : (
              fields.map((def) => (
                <FieldSwitch
                  key={def.id}
                  def={def}
                  draft={draft}
                  setField={setField}
                  invalid={invalid.includes(def.id)}
                />
              ))
            )}
          </div>
        )}
        {invalid.length ? (
          <p
            role="alert"
            className="mt-4 rounded-lg bg-destructive-soft px-3 py-2 text-xs font-medium text-destructive"
          >
            {t('wizard.required')}
          </p>
        ) : null}
      </div>

      {/* Footer */}
      <div className="border-t border-border bg-card px-5 py-4">
        {isLast ? (
          <p className="mb-3 flex items-start gap-2 text-[11px] leading-4 text-muted-foreground">
            <Lock size={13} className="mt-0.5 shrink-0 text-primary" aria-hidden="true" />
            {t('wizard.actionConsent')}
          </p>
        ) : null}
        <div className="flex items-center justify-between gap-3">
          <Button
            variant="ghost"
            disabled={step === 1 || patch.isPending}
            onClick={() => goTo(step - 1)}
          >
            <ArrowLeft size={16} aria-hidden="true" /> {t('common.back')}
          </Button>
          {isLast ? (
            <Button
              size="lg"
              className="min-w-40"
              disabled={submitting}
              onClick={() => void onSubmit()}
            >
              {submitting ? t('wizard.submitting') : t('wizard.submit')}
              {!submitting ? <Check size={16} aria-hidden="true" /> : null}
            </Button>
          ) : (
            <Button disabled={patch.isPending} onClick={() => goTo(step + 1)}>
              {t('common.next')} <ArrowRight size={16} aria-hidden="true" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function Stepper({
  step,
  onJump,
  attention,
}: {
  step: number;
  onJump: (step: number) => void;
  attention: number[];
}) {
  const { tx } = useT();
  return (
    <ol className="mt-4 flex items-center gap-1" aria-label="Steps">
      {bookingWizard.steps.map((s, index) => {
        const state = s.step < step ? 'done' : s.step === step ? 'active' : 'todo';
        return (
          <li key={s.id} className="flex flex-1 items-center gap-1 last:flex-none">
            <button
              type="button"
              onClick={() => onJump(s.step)}
              disabled={state !== 'done'}
              aria-current={state === 'active' ? 'step' : undefined}
              title={tx(s.title)}
              className={cn(
                'relative flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-all',
                state === 'done' && 'bg-primary text-white hover:bg-primary-strong',
                state === 'active' && 'bg-primary text-white ring-4 ring-primary/20',
                state === 'todo' && 'bg-muted text-muted-foreground',
              )}
            >
              {state === 'done' ? <Check size={13} strokeWidth={3} aria-hidden="true" /> : s.step}
              {attention.includes(s.step) && state !== 'active' ? (
                <span
                  aria-hidden="true"
                  className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full bg-warning ring-2 ring-card animate-pulse-soft"
                />
              ) : null}
            </button>
            {index < bookingWizard.steps.length - 1 ? (
              <span
                aria-hidden="true"
                className={cn(
                  'h-0.5 flex-1 rounded-full transition-colors',
                  s.step < step ? 'bg-primary' : 'bg-border',
                )}
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function FieldSwitch({
  def,
  draft,
  setField,
  invalid,
}: {
  def: WizardFieldDefinition;
  draft: WizardDraft;
  setField: (id: string, value: WizardDraft['fields'][string]['value']) => void;
  invalid: boolean;
}) {
  const commit = (value: WizardDraft['fields'][string]['value']) => setField(def.id, value);
  switch (def.type) {
    case 'select':
      return def.id === 'serviceType' ? (
        <ServiceField def={def} draft={draft} onCommit={commit} invalid={invalid} />
      ) : (
        <SelectField def={def} draft={draft} onCommit={commit} invalid={invalid} />
      );
    case 'boolean':
      return <BooleanField def={def} draft={draft} onCommit={commit} />;
    case 'list':
      return <ListField def={def} draft={draft} />;
    case 'text':
    case 'textarea':
    case 'postcode':
      return <TextField def={def} draft={draft} onCommit={commit} invalid={invalid} />;
    default:
      return null;
  }
}

function StepThree({
  draft,
  fields,
  setField,
  invalid,
}: {
  draft: WizardDraft;
  fields: WizardFieldDefinition[];
  setField: (id: string, value: WizardDraft['fields'][string]['value']) => void;
  invalid: string[];
}) {
  const postcode = fields.find((f) => f.id === 'postcode');
  const provider = fields.find((f) => f.id === 'providerId');
  const slot = fields.find((f) => f.id === 'slotId');
  return (
    <>
      {postcode ? (
        <FieldSwitch
          def={postcode}
          draft={draft}
          setField={setField}
          invalid={invalid.includes('postcode')}
        />
      ) : null}
      {provider && slot ? (
        <ProviderField
          def={provider}
          slotDef={slot}
          draft={draft}
          onCommit={setField}
          invalidProvider={invalid.includes('providerId')}
          invalidSlot={invalid.includes('slotId')}
        />
      ) : null}
    </>
  );
}

function CoverStep({ draft }: { draft: WizardDraft }) {
  const { t } = useT();
  const profile = useQuery({ queryKey: keys.profile, queryFn: api.profile });
  const service = stringOf(draft, 'serviceType') || 'gp';
  const cover = profile.data?.covers.find((c) => c.service === service);
  if (!cover) return <Skeleton className="h-40" />;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <SourceTag source="cover" />
        <span className="text-xs text-muted-foreground">{t('wizard.readonlyNote')}</span>
      </div>
      <CoverCard cover={cover} expanded />
    </div>
  );
}

function ConfirmStep({
  draft,
  fields,
  setField,
}: {
  draft: WizardDraft;
  fields: WizardFieldDefinition[];
  setField: (id: string, value: WizardDraft['fields'][string]['value']) => void;
}) {
  const { t, tx, locale } = useT();
  const providerId = stringOf(draft, 'providerId');
  const provider = useQuery({
    queryKey: ['provider', providerId],
    queryFn: () => api.provider(providerId),
    enabled: !!providerId,
  });
  const slot = provider.data?.slots.find((s) => s.id === stringOf(draft, 'slotId'));
  const serviceOption = bookingWizard.fields
    .find((f) => f.id === 'serviceType')
    ?.options?.find((o) => o.value === stringOf(draft, 'serviceType'));
  const rows: Array<[string, string]> = [
    [
      tx(bookingWizard.fields.find((f) => f.id === 'serviceType')!.label),
      serviceOption ? tx(serviceOption.label) : '—',
    ],
    [tx(bookingWizard.fields.find((f) => f.id === 'need')!.label), stringOf(draft, 'need') || '—'],
    [t('wizard.clinic'), provider.data ? provider.data.name.replace(' (demo)', '') : '—'],
    [
      tx(bookingWizard.fields.find((f) => f.id === 'slotId')!.label),
      slot ? formatDateTime(slot.startsAt, locale) : '—',
    ],
    [t('profile.field.name'), stringOf(draft, 'patientName') || '—'],
    [t('profile.field.memberNumber'), stringOf(draft, 'memberNumber') || '—'],
    [t('profile.field.phone'), stringOf(draft, 'phone') || '—'],
    [
      t('profile.field.preferredLanguage'),
      stringOf(draft, 'language') ? languageName(stringOf(draft, 'language'), locale) : '—',
    ],
    [
      t('profile.field.interpreter'),
      draft.fields.interpreter?.value === true ? t('common.yes') : t('common.no'),
    ],
  ];
  return (
    <div className="space-y-5">
      <div>
        <p className="mb-2 text-sm font-medium">{t('wizard.summary')}</p>
        <dl className="divide-y divide-border rounded-xl border border-border bg-card">
          {rows.map(([label, value]) => (
            <div key={label} className="grid grid-cols-[120px_1fr] gap-3 px-3.5 py-2.5 text-sm">
              <dt className="text-xs leading-5 text-muted-foreground">{label}</dt>
              <dd className="font-medium leading-5">{value}</dd>
            </div>
          ))}
        </dl>
      </div>
      {fields.map((def) => (
        <FieldSwitch key={def.id} def={def} draft={draft} setField={setField} invalid={false} />
      ))}
    </div>
  );
}
