import { AlertTriangle, CloudOff, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useT } from '@/i18n';
import { api } from '@/lib/api';
import type { PersistenceStatus } from '@/mock/persistence';

/** Small status line for the browser-side history store; silent when everything is fine. */
export function PersistenceBanner() {
  const { t } = useT();
  const [status, setStatus] = useState<PersistenceStatus>(() => api.persistence.status());
  useEffect(() => api.persistence.onChange(setStatus), []);
  if (api.features.storage !== 'browser') return null;

  if (status.state === 'error') {
    return (
      <p className="flex items-center gap-2 text-xs text-destructive" role="alert">
        <AlertTriangle size={13} aria-hidden="true" />
        {t('persist.error')}
        <button
          type="button"
          onClick={() => void api.persistence.retry()}
          className="rounded-md border border-destructive/40 px-2 py-0.5 font-semibold hover:bg-destructive-soft"
        >
          {t('common.retry')}
        </button>
      </p>
    );
  }
  if (status.state === 'unavailable') {
    return (
      <p className="flex items-center gap-1.5 text-xs text-warning" role="status">
        <CloudOff size={13} aria-hidden="true" /> {t('persist.unavailable')}
      </p>
    );
  }
  if (status.state === 'corrupt') {
    return (
      <p className="flex items-center gap-1.5 text-xs text-destructive" role="alert">
        <AlertTriangle size={13} aria-hidden="true" /> {t('persist.corrupt')}
      </p>
    );
  }
  if (status.state === 'saving') {
    return (
      <p className="flex items-center gap-1.5 text-[11px] text-subtle" role="status">
        <Loader2 size={12} className="animate-spin" aria-hidden="true" /> {t('persist.saving')}
      </p>
    );
  }
  return null;
}
