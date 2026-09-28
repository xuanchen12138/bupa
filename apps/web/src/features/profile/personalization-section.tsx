import { Database, History, ReceiptText, ShieldCheck } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Badge, Card, SectionHeading, Switch } from '@/components/ui/primitives';
import { toast } from '@/components/ui/toast';
import { useT } from '@/i18n';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { invalidateAll, keys } from '@/lib/query';
import { useNavigation } from '@/stores/navigation';

/**
 * Two separate controls: conversations are saved (so they can be reopened and deleted), and
 * cross-conversation personalisation is a switch of its own with a purpose receipt.
 */
export function PersonalizationSection() {
  const { t, locale } = useT();
  const enabled = api.features.personalization;
  const settings = useQuery({
    queryKey: keys.personalization,
    queryFn: api.personalization,
    enabled,
  });
  const conversations = useQuery({
    queryKey: keys.conversations,
    queryFn: api.conversations,
    enabled: api.features.conversations,
  });
  const focusReceipt = useNavigation((s) => s.focusReceipt);

  const toggle = async (next: boolean) => {
    await api.setPersonalization({ enabled: next });
    invalidateAll();
    toast({
      title: next ? t('personal.enabledToast') : t('personal.disabledToast'),
      tone: next ? 'success' : 'receipt',
    });
  };

  const count = conversations.data?.items.length ?? 0;
  const data = settings.data;

  return (
    <Card className="p-5">
      <SectionHeading title={t('personal.title')} hint={t('personal.hint')} />
      <ul className="mt-4 divide-y divide-border">
        <li className="flex items-start gap-4 py-4">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
            <History size={17} aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">{t('personal.saveTitle')}</p>
            <p className="mt-0.5 text-sm leading-6 text-muted-foreground">
              {t('personal.saveBody')}
            </p>
            <p className="mt-1.5 flex items-center gap-1.5 text-xs text-subtle">
              <Database size={12} aria-hidden="true" />
              {api.features.storage === 'browser' ? t('history.storage') : t('history.unavailable')}
              {api.features.conversations
                ? ` · ${count === 1 ? t('personal.countOne') : `${count} ${t('personal.countMany')}`}`
                : ''}
            </p>
          </div>
        </li>
        <li className="flex items-start gap-4 py-4">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-violet-soft text-violet">
            <ShieldCheck size={17} aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold">{t('personal.toggleTitle')}</p>
              {data ? (
                <Badge tone={data.enabled ? 'success' : 'neutral'}>
                  {data.enabled ? t('personal.on') : t('personal.off')}
                </Badge>
              ) : null}
              {data?.presetByDemo ? <Badge tone="warning">{t('personal.preset')}</Badge> : null}
            </div>
            <p className="mt-0.5 text-sm leading-6 text-muted-foreground">
              {t('personal.toggleBody')}
            </p>
            {!enabled ? (
              <p className="mt-1.5 text-xs text-subtle">{t('personal.unavailable')}</p>
            ) : data ? (
              <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-subtle">
                {data.updatedAt ? (
                  <span>
                    {t('health.updated')} {formatDateTime(data.updatedAt, locale)}
                  </span>
                ) : null}
                {data.receiptId ? (
                  <button
                    type="button"
                    onClick={() => focusReceipt(data.receiptId)}
                    className="inline-flex items-center gap-1 font-semibold text-primary hover:underline"
                  >
                    <ReceiptText size={12} aria-hidden="true" /> {t('personal.receipt')}
                  </button>
                ) : null}
              </p>
            ) : null}
          </div>
          <Switch
            checked={data?.enabled ?? false}
            disabled={!enabled || !data}
            onCheckedChange={(next) => void toggle(next)}
            label={t('personal.toggleTitle')}
          />
        </li>
      </ul>
    </Card>
  );
}
