import { ArrowUp, Languages, Square } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useT } from '@/i18n';
import { cn } from '@/lib/utils';
import { useChat } from '@/stores/chat';

export function Composer({ autoFocus }: { autoFocus?: boolean }) {
  const { t } = useT();
  const [value, setValue] = useState('');
  const send = useChat((s) => s.send);
  const selectedId = useChat((s) => s.selectedId);
  const view = useChat((s) => (s.selectedId ? s.views[s.selectedId] : undefined));
  const creating = useChat((s) => s.creating);
  const prefill = useChat((s) => s.composerPrefill);
  const setPrefill = useChat((s) => s.setComposerPrefill);
  const cancelRunning = useChat((s) => s.cancelRunning);
  const showTranslations = useChat((s) => s.showTranslations);
  const toggleTranslations = useChat((s) => s.toggleTranslations);
  const ref = useRef<HTMLTextAreaElement>(null);
  const running = view?.running ?? false;
  const pendingConsentId = view?.pendingConsentId ?? null;

  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus, selectedId]);

  // A suggestion can place editable text here; the member finishes the sentence and sends.
  useEffect(() => {
    if (prefill === null) return;
    setValue(prefill);
    setPrefill(null);
    const el = ref.current;
    if (el) {
      el.focus();
      requestAnimationFrame(() => el.setSelectionRange(el.value.length, el.value.length));
    }
  }, [prefill, setPrefill]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [value]);

  const submit = () => {
    if (!value.trim() || running || creating) return;
    void send(value);
    setValue('');
  };
  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  };
  const disabled = running && pendingConsentId !== null;

  return (
    <div className="mx-auto w-full max-w-[760px] px-8 pb-5 pt-2">
      <div
        className={cn(
          'flex items-end gap-2 rounded-2xl border border-border bg-card p-2 pl-4 shadow-md transition-shadow focus-within:border-primary focus-within:ring-4 focus-within:ring-primary/12',
        )}
      >
        <textarea
          ref={ref}
          rows={1}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={onKey}
          placeholder={disabled ? t('consent.pending') : t('chat.placeholder')}
          disabled={disabled}
          aria-label={t('chat.placeholder')}
          className="max-h-40 min-h-[40px] flex-1 resize-none bg-transparent py-2.5 text-[15px] leading-6 outline-none placeholder:text-subtle disabled:opacity-60"
        />
        {running ? (
          <button
            type="button"
            onClick={() => void cancelRunning()}
            aria-label={t('common.stop')}
            title={t('common.stop')}
            className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-border bg-card text-foreground shadow-sm transition-all hover:bg-muted active:scale-95"
          >
            <Square size={14} fill="currentColor" aria-hidden="true" />
          </button>
        ) : (
          <button
            type="button"
            onClick={submit}
            disabled={!value.trim() || creating}
            aria-label={t('chat.send')}
            className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary text-white shadow-sm transition-all hover:bg-primary-strong disabled:opacity-40 active:scale-95"
          >
            <ArrowUp size={18} aria-hidden="true" />
          </button>
        )}
      </div>
      <div className="mt-2 flex items-center justify-between px-1 text-[11px] text-subtle">
        <span>{t('chat.boundaries')}</span>
        <button
          type="button"
          onClick={toggleTranslations}
          aria-pressed={showTranslations}
          className={cn(
            'inline-flex items-center gap-1 rounded-full px-2 py-0.5 transition-colors hover:text-foreground',
            showTranslations && 'bg-primary-soft text-primary-strong',
          )}
        >
          <Languages size={12} aria-hidden="true" />
          {t('shell.translations')}
        </button>
      </div>
    </div>
  );
}
