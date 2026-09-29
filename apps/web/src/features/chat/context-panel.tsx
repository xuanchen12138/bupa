import {
  Check,
  ClipboardList,
  Loader2,
  ShieldCheck,
  ToggleLeft,
  ToggleRight,
  X,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import type { ProfileFieldName } from '@bupa/contracts';
import { Button } from '@/components/ui/button';
import { useT } from '@/i18n';
import { api } from '@/lib/api';
import { keys } from '@/lib/query';
import { cn } from '@/lib/utils';
import { useChat } from '@/stores/chat';
import { useNavigation } from '@/stores/navigation';
import { useWizard } from '@/stores/wizard';

const watched: ProfileFieldName[] = [
  'preferredTime',
  'travelDuration',
  'preferredLanguage',
  'consultPreference',
];

export function ContextPanel({ conversationId }: { conversationId: string | null }) {
  const { t } = useT();
  const items = useChat((s) => (conversationId ? s.views[conversationId]?.items : undefined));
  const tools = (items ?? []).filter((i) => i.kind === 'tool');
  const schedule = useQuery({ queryKey: keys.schedule, queryFn: api.schedule });
  const profile = useQuery({ queryKey: keys.profile, queryFn: api.profile });
  const openWizard = useWizard((s) => s.open);
  const navigate = useNavigation((s) => s.navigate);
  // Only a draft prepared in this conversation is offered here; others live on the Dashboard.
  const draft = conversationId
    ? schedule.data?.drafts.find((d) => (d.conversationId ?? null) === conversationId)
    : undefined;

  return (
    <div className="scroll-quiet flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-5 py-5">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-subtle">
          {t('chat.panelTitle')}
        </p>
        {tools.length ? (
          <ol className="mt-3 space-y-2">
            {tools.slice(-8).map((tool) => (
              <li key={tool.id} className="flex items-center gap-2.5 text-sm">
                {tool.status === 'running' ? (
                  <Loader2 size={14} className="animate-spin text-primary" aria-hidden="true" />
                ) : tool.status === 'done' ? (
                  <span className="flex size-[14px] items-center justify-center rounded-full bg-success text-white">
                    <Check size={9} strokeWidth={3} aria-hidden="true" />
                  </span>
                ) : (
                  <span className="flex size-[14px] items-center justify-center rounded-full bg-muted text-muted-foreground">
                    <X size={9} strokeWidth={3} aria-hidden="true" />
                  </span>
                )}
                <span className={cn(tool.status !== 'running' && 'text-muted-foreground')}>
                  {tool.label}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-3 text-sm leading-6 text-muted-foreground">{t('chat.panelEmpty')}</p>
        )}
      </div>

      {draft ? (
        <div className="rounded-xl border border-primary/25 bg-primary-soft/40 p-4">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <ClipboardList size={16} className="text-primary" aria-hidden="true" />
            {t('dash.drafts')}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {t('dash.draftStep')} {draft.step} / 5
          </p>
          <Button
            size="sm"
            className="mt-3"
            onClick={() => openWizard(draft.id, 'chat', conversationId)}
          >
            {t('wizard.resume')}
          </Button>
        </div>
      ) : null}

      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-subtle">
          {t('permission.label')}
        </p>
        <ul className="mt-3 divide-y divide-border rounded-xl border border-border">
          {watched.map((field) => {
            const permission = profile.data?.member.fields[field].permission ?? 'off';
            const on = permission !== 'off';
            return (
              <li
                key={field}
                className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-sm"
              >
                <span>{t(`profile.field.${field}`)}</span>
                <span
                  className={cn(
                    'flex items-center gap-1.5 text-xs font-medium',
                    on ? 'text-success' : 'text-subtle',
                  )}
                >
                  {on ? (
                    <ToggleRight size={18} aria-hidden="true" />
                  ) : (
                    <ToggleLeft size={18} aria-hidden="true" />
                  )}
                  {t(`permission.${permission}`)}
                </span>
              </li>
            );
          })}
        </ul>
        <button
          type="button"
          onClick={() => navigate('profile')}
          className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline"
        >
          <ShieldCheck size={13} aria-hidden="true" />
          {t('profile.data')}
        </button>
      </div>
    </div>
  );
}
