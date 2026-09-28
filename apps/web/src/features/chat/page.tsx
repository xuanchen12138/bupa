import {
  AlertTriangle,
  BookOpenCheck,
  CalendarPlus,
  Compass,
  Loader2,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/primitives';
import { useT } from '@/i18n';
import { cn } from '@/lib/utils';
import { useChat } from '@/stores/chat';
import { useWizard } from '@/stores/wizard';
import { WizardPanel } from '@/features/wizard/panel';
import { Composer } from './composer';
import { ContextPanel } from './context-panel';
import { PersistenceBanner } from './persistence-banner';
import { Timeline } from './timeline';

export function ChatPage() {
  const { t, locale } = useT();
  const selectedId = useChat((s) => s.selectedId);
  const view = useChat((s) => (s.selectedId ? s.views[s.selectedId] : undefined));
  const load = useChat((s) => s.load);
  const send = useChat((s) => s.send);
  const openDraftId = useWizard((s) => s.openDraftId);
  const host = useWizard((s) => s.host);
  const wizardConversation = useWizard((s) => s.conversationId);
  const wizardOpen =
    openDraftId !== null &&
    host === 'chat' &&
    (wizardConversation === null || wizardConversation === selectedId);

  useEffect(() => {
    if (selectedId) void load(selectedId);
  }, [selectedId, load]);

  const starters =
    locale === 'zh'
      ? [
          '我这两天喉咙痛、有点低烧，想看医生，但不知道保险能报多少，也不知道去哪',
          '急诊和 GP 有什么区别？',
          '最近压力很大',
        ]
      : [
          'I have had a sore throat and a low fever for two days—I want to see a doctor but I do not know what my cover pays or where to go',
          'What is the difference between emergency and a GP?',
          'I have been really stressed lately',
        ];

  const hasItems = Boolean(view?.items.length);
  const title = view?.conversation?.title;

  return (
    <div className="flex h-full">
      {/* -------------------------------------------------------- Conversation */}
      <section className="flex min-w-0 flex-1 flex-col" aria-label={t('nav.chat')}>
        <div className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-border/70 px-6">
          <p className="min-w-0 truncate text-xs font-medium text-muted-foreground">
            {title ? (
              <>
                <span className="text-foreground">{title}</span>
                {view?.conversation?.seeded ? (
                  <span className="ml-2 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-subtle">
                    {t('history.sample')}
                  </span>
                ) : null}
              </>
            ) : (
              t('chat.assistant')
            )}
          </p>
          <PersistenceBanner />
        </div>

        <div
          className={cn(
            'scroll-quiet min-h-0 flex-1 overflow-y-auto',
            !hasItems && !view?.loading && 'hero-grid',
          )}
        >
          {selectedId && view?.loading && !hasItems ? (
            <div className="mx-auto w-full max-w-[760px] space-y-4 px-8 py-8">
              <Skeleton className="h-12 w-2/3" />
              <Skeleton className="h-24" />
              <Skeleton className="h-16 w-1/2" />
            </div>
          ) : selectedId && view?.error && !hasItems ? (
            <div className="mx-auto flex w-full max-w-[760px] flex-col items-start gap-3 px-8 py-10">
              <p className="flex items-center gap-2 text-sm text-destructive">
                <AlertTriangle size={16} aria-hidden="true" /> {t('history.loadError')}
              </p>
              <Button variant="outline" size="sm" onClick={() => void load(selectedId, true)}>
                {t('common.retry')}
              </Button>
            </div>
          ) : selectedId && view && hasItems ? (
            <Timeline conversationId={selectedId} view={view} />
          ) : (
            <div className="mx-auto flex h-full w-full max-w-[760px] flex-col justify-center px-8 py-10">
              <div className="mb-5 flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-violet text-white shadow-md">
                <Sparkles size={22} aria-hidden="true" />
              </div>
              <h1 className="text-[28px] font-semibold leading-tight tracking-tight">
                {t('chat.title')}
              </h1>
              <p className="mt-3 max-w-xl text-[15px] leading-7 text-muted-foreground">
                {t('chat.subtitle')}
              </p>

              <div className="mt-8 grid grid-cols-3 gap-3">
                {[
                  {
                    icon: BookOpenCheck,
                    en: 'Explain my cover',
                    zh: '解释我的保障',
                    sub: { en: 'With the clause it comes from', zh: '附条款出处' },
                  },
                  {
                    icon: Compass,
                    en: 'Find the right service',
                    zh: '找到该去的服务',
                    sub: { en: 'GP, video, mental health, emergency', zh: 'GP、视频、心理、急诊' },
                  },
                  {
                    icon: CalendarPlus,
                    en: 'Prepare a booking',
                    zh: '准备好预约',
                    sub: { en: 'You confirm every step', zh: '每一步由你确认' },
                  },
                ].map(({ icon: Icon, en, zh, sub }) => (
                  <div
                    key={en}
                    className="rounded-xl border border-border bg-card/80 p-4 shadow-xs backdrop-blur"
                  >
                    <Icon size={18} className="text-primary" aria-hidden="true" />
                    <p className="mt-2.5 text-sm font-semibold">{locale === 'zh' ? zh : en}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {locale === 'zh' ? sub.zh : sub.en}
                    </p>
                  </div>
                ))}
              </div>

              <p className="mt-8 text-[11px] font-semibold uppercase tracking-wider text-subtle">
                {t('chat.suggestionsTitle')}
              </p>
              <div className="mt-2.5 flex flex-col items-start gap-2">
                {starters.map((starter) => (
                  <button
                    key={starter}
                    type="button"
                    onClick={() => void send(starter)}
                    className="rounded-2xl border border-border bg-card px-4 py-2.5 text-left text-sm leading-6 shadow-xs transition-all hover:-translate-y-px hover:border-primary/50 hover:shadow-md"
                  >
                    {starter}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <Composer autoFocus />
      </section>

      {/* ------------------------------------------------------- Right panel */}
      <aside
        className={cn(
          'flex shrink-0 flex-col border-l border-border bg-card transition-[width] duration-300',
          wizardOpen ? 'w-[460px]' : 'w-[340px]',
        )}
        aria-label={t('chat.panelTitle')}
      >
        {wizardOpen && openDraftId ? (
          <WizardPanel draftId={openDraftId} />
        ) : (
          <ContextPanel conversationId={selectedId} />
        )}
        {!wizardOpen ? (
          <p className="flex items-center gap-1.5 border-t border-border px-5 py-3 text-[11px] text-subtle">
            <ShieldCheck size={13} aria-hidden="true" />
            {t('chat.boundaries')}
          </p>
        ) : null}
      </aside>
      {view?.loading && hasItems ? (
        <Loader2 size={14} className="sr-only animate-spin" aria-hidden="true" />
      ) : null}
    </div>
  );
}
