import {
  AlertTriangle,
  CalendarDays,
  Languages,
  MessageSquareText,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  UserRound,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, apiMode } from '@/lib/api';
import { keys, invalidateAll, queryClient } from '@/lib/query';
import { cn } from '@/lib/utils';
import { useT, useLocale } from '@/i18n';
import { useNavigation, type Page } from '@/stores/navigation';
import { useChat } from '@/stores/chat';
import { useWizard } from '@/stores/wizard';
import { Button } from '@/components/ui/button';
import { Segmented } from '@/components/ui/primitives';
import { ToastViewport, toast } from '@/components/ui/toast';
import { ChatPage } from '@/features/chat/page';
import { HistoryList } from '@/features/chat/history-list';
import { DashboardPage } from '@/features/dashboard/page';
import { ProfilePage } from '@/features/profile/page';

const pages: Array<{
  id: Page;
  key: 'nav.chat' | 'nav.dashboard' | 'nav.profile';
  icon: typeof MessageSquareText;
}> = [
  { id: 'chat', key: 'nav.chat', icon: MessageSquareText },
  { id: 'dashboard', key: 'nav.dashboard', icon: CalendarDays },
  { id: 'profile', key: 'nav.profile', icon: UserRound },
];

export function App() {
  const { t } = useT();
  const { locale, setLocale } = useLocale();
  const { page, navigate } = useNavigation();
  const [ready, setReady] = useState(false);
  const health = useQuery({ queryKey: keys.health, queryFn: api.health, enabled: ready });
  const profile = useQuery({ queryKey: keys.profile, queryFn: api.profile, enabled: ready });
  const memberName = profile.data?.member.fields.name.value ?? 'Lin';
  const initError = ready ? api.persistence.initError() : null;

  // Nothing is read or written until the saved snapshot has been loaded (or seeded once).
  useEffect(() => {
    api.setLocale(locale);
    void api.persistence.ready().then(() => setReady(true));
  }, [locale]);

  const resetDemo = async () => {
    await api.reset({ locale });
    useChat.getState().reset();
    useWizard.getState().close();
    queryClient.clear();
    invalidateAll();
    navigate('chat');
    toast({ title: t('shell.resetDone'), tone: 'success' });
  };

  return (
    <div className="flex h-full min-h-screen bg-background text-foreground">
      {/* ------------------------------------------------------------ Sidebar */}
      <aside className="flex w-[264px] shrink-0 flex-col border-r border-border bg-card px-4 py-5">
        <div className="flex items-center gap-3 px-2">
          <div className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-md">
            <Sparkles size={20} aria-hidden="true" />
          </div>
          <div className="leading-tight">
            <p className="text-[11px] font-semibold tracking-[0.18em] text-primary">
              {t('app.name').toUpperCase()}
            </p>
            <p className="text-lg font-semibold tracking-tight">{t('app.agent')}</p>
          </div>
        </div>

        <nav aria-label="Main" className="mt-6 space-y-1">
          {pages.map(({ id, key, icon: Icon }) => {
            const active = page === id;
            return (
              <button
                key={id}
                type="button"
                aria-current={active ? 'page' : undefined}
                onClick={() => navigate(id)}
                className={cn(
                  'group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-all duration-150 focus-visible:outline-2 focus-visible:outline-ring',
                  active
                    ? 'bg-primary-soft font-semibold text-primary-strong shadow-[inset_0_0_0_1px_rgb(0_121_200_/_0.12)]'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                <Icon
                  size={18}
                  aria-hidden="true"
                  className={cn(
                    'transition-transform',
                    active ? 'scale-105' : 'group-hover:scale-105',
                  )}
                />
                {t(key)}
              </button>
            );
          })}
        </nav>

        {ready ? <HistoryList /> : <div className="min-h-0 flex-1" />}

        <div className="mt-4 space-y-3">
          <p className="px-1 text-[11px] leading-4 text-subtle">
            {api.features.storage === 'browser' ? t('history.storage') : t('history.unavailable')}
          </p>
          <div className="rounded-xl border border-border bg-background/60 p-3">
            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <Languages size={14} aria-hidden="true" />
              {t('shell.language')}
            </div>
            <Segmented
              className="mt-2 w-full"
              value={locale}
              onChange={setLocale}
              label={t('shell.language')}
              options={[
                { value: 'en', label: 'English' },
                { value: 'zh', label: '中文' },
              ]}
            />
          </div>
          <div className="flex items-center gap-3 rounded-xl bg-muted p-3">
            <div className="flex size-9 items-center justify-center rounded-full bg-gradient-to-br from-primary to-violet text-sm font-semibold text-white">
              {memberName.slice(0, 1)}
            </div>
            <div className="min-w-0 leading-tight">
              <p className="truncate text-sm font-semibold">{memberName}</p>
              <p className="truncate text-[11px] text-muted-foreground">
                {profile.data?.member.productName ?? 'OSHC'}
              </p>
            </div>
          </div>
          <p className="flex items-start gap-1.5 px-1 text-[11px] leading-4 text-subtle">
            <ShieldCheck size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
            {t('shell.demoBadge')}
          </p>
        </div>
      </aside>

      {/* ------------------------------------------------------------ Content */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-card/80 px-6 backdrop-blur">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span
              aria-hidden="true"
              className={cn(
                'size-2 rounded-full',
                health.isSuccess
                  ? 'bg-success'
                  : health.isError
                    ? 'bg-destructive'
                    : 'bg-warning animate-pulse-soft',
              )}
            />
            <span role="status">
              {health.isSuccess
                ? t('shell.connected')
                : health.isError
                  ? t('shell.disconnected')
                  : t('shell.connecting')}
            </span>
            {apiMode === 'mock' ? (
              <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-subtle">
                {t('shell.mock')}
              </span>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => void resetDemo()}
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <RotateCcw size={14} aria-hidden="true" />
            {t('shell.reset')}
          </button>
        </header>
        {initError?.kind === 'corrupt' ? (
          <div
            role="alert"
            className="flex items-center gap-3 border-b border-destructive/30 bg-destructive-soft px-6 py-2.5 text-sm text-destructive"
          >
            <AlertTriangle size={16} aria-hidden="true" />
            <span className="flex-1">{t('persist.corrupt')}</span>
            <Button size="sm" variant="destructive" onClick={() => void resetDemo()}>
              {t('shell.reset')}
            </Button>
          </div>
        ) : null}
        <main className="min-h-0 flex-1">
          {!ready ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              {t('persist.loading')}
            </div>
          ) : (
            <>
              {page === 'chat' && <ChatPage />}
              {page === 'dashboard' && <DashboardPage />}
              {page === 'profile' && <ProfilePage />}
            </>
          )}
        </main>
      </div>
      <ToastViewport />
    </div>
  );
}
