import {
  Bell,
  Building2,
  CalendarClock,
  Languages,
  MapPin,
  Navigation,
  Package,
  Sparkles,
  StickyNote,
  Video,
  Wallet,
} from 'lucide-react';
import { useState } from 'react';
import type { Booking, Note, Reminder } from '@bupa/contracts';
import { Button } from '@/components/ui/button';
import { Badge, Card, Input, Switch } from '@/components/ui/primitives';
import { toast } from '@/components/ui/toast';
import { useT } from '@/i18n';
import { api } from '@/lib/api';
import {
  formatDateTime,
  formatDayLabel,
  formatMoneyRange,
  formatTime,
  languageName,
} from '@/lib/format';
import { invalidateAll } from '@/lib/query';
import { cn } from '@/lib/utils';

/**
 * Everything about one confirmed appointment in one place: when and where, what it costs,
 * what to bring, its reminder, its notes, and the two things the member can do about it.
 */
export function AppointmentCard({
  booking,
  reminders,
  notes,
  highlighted,
  onReschedule,
}: {
  booking: Booking;
  reminders: Reminder[];
  notes: Note[];
  highlighted: boolean;
  onReschedule: (id: string) => void;
}) {
  const { t, locale } = useT();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [busy, setBusy] = useState(false);

  const cancel = async () => {
    setBusy(true);
    try {
      await api.cancelBooking(booking.id);
      invalidateAll();
      toast({ title: t('dash.cancelled'), body: booking.provider.name, tone: 'receipt' });
    } finally {
      setBusy(false);
      setConfirmCancel(false);
    }
  };
  const addNote = async () => {
    if (!noteText.trim()) return;
    await api.createNote({ bookingId: booking.id, text: noteText.trim() });
    setNoteText('');
    invalidateAll();
  };

  const name = booking.provider.name.replace(' (demo)', '');
  return (
    <Card
      className={cn('overflow-hidden', highlighted && 'border-primary ring-4 ring-primary/15')}
      data-booking-id={booking.id}
    >
      {/* Header: when + where */}
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border px-5 py-4">
        <div className="flex items-start gap-3">
          <div
            className={cn(
              'flex size-11 shrink-0 items-center justify-center rounded-xl text-white',
              booking.provider.telehealth ? 'bg-violet' : 'bg-primary',
            )}
          >
            {booking.provider.telehealth ? (
              <Video size={18} aria-hidden="true" />
            ) : (
              <Building2 size={18} aria-hidden="true" />
            )}
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-primary-strong">
              {formatDayLabel(
                booking.slot.startsAt,
                locale,
                t('common.today'),
                t('common.tomorrow'),
              )}{' '}
              · {formatTime(booking.slot.startsAt, locale)} –{' '}
              {formatTime(booking.slot.endsAt, locale)}
            </p>
            <h3 className="mt-0.5 text-lg font-semibold tracking-tight">{name}</h3>
            <p className="text-sm text-muted-foreground">
              {t(`service.${booking.service}`)} · {booking.need}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="success">{t('dash.confirmed')}</Badge>
          <Badge tone={booking.provider.relationship === 'bupa_owned' ? 'primary' : 'neutral'}>
            {t(`relationship.${booking.provider.relationship}`)}
          </Badge>
        </div>
      </div>

      {/* Facts grid */}
      <dl className="grid gap-x-6 gap-y-3 px-5 py-4 text-sm md:grid-cols-2">
        <div className="flex items-start gap-2.5">
          <MapPin size={16} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">
              {booking.provider.telehealth ? t('common.online') : t('dash.directions')}
            </dt>
            <dd className="flex flex-wrap items-center gap-x-3">
              <span>{booking.provider.address}</span>
              {!booking.provider.telehealth ? (
                <a
                  className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
                  href={`https://www.google.com/maps/search/${encodeURIComponent(booking.provider.address)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Navigation size={12} aria-hidden="true" /> {t('dash.directions')}
                </a>
              ) : null}
            </dd>
          </div>
        </div>
        <div className="flex items-start gap-2.5">
          <Wallet size={16} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div>
            <dt className="text-xs text-muted-foreground">{t('dash.outOfPocket')}</dt>
            <dd className={cn('font-semibold', booking.outOfPocket?.max === 0 && 'text-success')}>
              {formatMoneyRange(
                booking.outOfPocket,
                locale,
                t('common.free'),
                t('common.unknownCost'),
              )}
            </dd>
          </div>
        </div>
        <div className="flex items-start gap-2.5">
          <Languages
            size={16}
            className="mt-0.5 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          <div>
            <dt className="text-xs text-muted-foreground">
              {t('profile.field.preferredLanguage')}
            </dt>
            <dd>
              {booking.language ? languageName(booking.language, locale) : '—'}
              {booking.interpreter ? ` · ${t('profile.field.interpreter')}` : ''}
              <span className="text-muted-foreground"> · {booking.patientName}</span>
            </dd>
          </div>
        </div>
        <div className="flex items-start gap-2.5">
          <Package size={16} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div>
            <dt className="text-xs text-muted-foreground">{t('dash.whatToBring')}</dt>
            <dd>{booking.whatToBring.length ? booking.whatToBring.join(' · ') : '—'}</dd>
          </div>
        </div>
      </dl>

      {/* Reminders + notes for this appointment */}
      <div className="grid gap-4 border-t border-border bg-background/50 px-5 py-4 md:grid-cols-2">
        <div>
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
            <Bell size={13} aria-hidden="true" /> {t('dash.reminders')}
          </p>
          {reminders.length ? (
            <ul className="space-y-2">
              {reminders.map((reminder) => (
                <li key={reminder.id} className="flex items-center gap-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <p
                      className={cn(
                        'truncate',
                        !reminder.enabled && 'text-muted-foreground line-through',
                      )}
                    >
                      {reminder.text}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatDateTime(reminder.at, locale)} · {t(`dash.by.${reminder.createdBy}`)}
                    </p>
                  </div>
                  <Switch
                    checked={reminder.enabled}
                    onCheckedChange={(enabled) =>
                      api.toggleReminder(reminder.id, enabled).then(invalidateAll)
                    }
                    label={reminder.text}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">{t('dash.noReminders')}</p>
          )}
        </div>
        <div>
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
            <StickyNote size={13} aria-hidden="true" /> {t('dash.notes')}
          </p>
          {notes.length ? (
            <ul className="mb-2 space-y-1.5">
              {notes.map((note) => (
                <li key={note.id} className="rounded-lg bg-card px-3 py-2 text-sm shadow-xs">
                  <p className="leading-5">{note.text}</p>
                  <p className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
                    {note.createdBy === 'ai' ? (
                      <Sparkles size={11} aria-hidden="true" />
                    ) : (
                      <StickyNote size={11} aria-hidden="true" />
                    )}
                    {t(`dash.by.${note.createdBy}`)}
                  </p>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="flex gap-2">
            <Input
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              placeholder={t('dash.notePlaceholder')}
              aria-label={t('dash.addNote')}
              onKeyDown={(e) => e.key === 'Enter' && void addNote()}
              className="h-9 py-1.5"
            />
            <Button
              size="sm"
              variant="soft"
              onClick={() => void addNote()}
              disabled={!noteText.trim()}
            >
              {t('dash.addNote')}
            </Button>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3">
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <CalendarClock size={13} aria-hidden="true" />
          {formatDateTime(booking.slot.startsAt, locale)}
        </p>
        {confirmCancel ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-destructive">{t('dash.cancelConfirm')}</span>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => setConfirmCancel(false)}
            >
              {t('common.back')}
            </Button>
            <Button size="sm" variant="destructive" disabled={busy} onClick={() => void cancel()}>
              {t('dash.cancelBooking')}
            </Button>
          </div>
        ) : (
          <div className="flex gap-2">
            <Button size="sm" variant="destructiveGhost" onClick={() => setConfirmCancel(true)}>
              {t('dash.cancelBooking')}
            </Button>
            <Button size="sm" variant="outline" onClick={() => onReschedule(booking.id)}>
              {t('dash.reschedule')}
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}
