import { ChevronLeft, ChevronRight, Video } from 'lucide-react';
import { useState } from 'react';
import type { Booking } from '@bupa/contracts';
import { Segmented } from '@/components/ui/primitives';
import { useT } from '@/i18n';
import { addDays, formatTime, isSameDay, startOfWeek } from '@/lib/format';
import { cn } from '@/lib/utils';

const HOURS = { start: 8, end: 20 };
const HOUR_HEIGHT = 44;

export function Calendar({
  bookings,
  onSelect,
  selectedId,
}: {
  bookings: Booking[];
  onSelect: (booking: Booking) => void;
  selectedId: string | null;
}) {
  const { t, locale } = useT();
  const [view, setView] = useState<'week' | 'month'>('week');
  const [cursor, setCursor] = useState(() => new Date());
  const intl = locale === 'zh' ? 'zh-CN' : 'en-AU';
  const today = new Date();
  const move = (direction: -1 | 1) =>
    setCursor((current) => {
      const next = new Date(current);
      if (view === 'week') next.setDate(next.getDate() + 7 * direction);
      else next.setMonth(next.getMonth() + direction);
      return next;
    });
  const title =
    view === 'week'
      ? `${new Intl.DateTimeFormat(intl, { day: 'numeric', month: 'short' }).format(startOfWeek(cursor))} – ${new Intl.DateTimeFormat(intl, { day: 'numeric', month: 'short', year: 'numeric' }).format(addDays(startOfWeek(cursor), 6))}`
      : new Intl.DateTimeFormat(intl, { month: 'long', year: 'numeric' }).format(cursor);

  return (
    <div className="rounded-2xl border border-border bg-card shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => move(-1)}
            aria-label="Previous"
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            type="button"
            onClick={() => move(1)}
            aria-label="Next"
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ChevronRight size={16} />
          </button>
          <button
            type="button"
            onClick={() => setCursor(new Date())}
            className="ml-1 rounded-lg px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            {t('common.today')}
          </button>
          <p className="ml-2 text-sm font-semibold">{title}</p>
        </div>
        <Segmented
          value={view}
          onChange={setView}
          options={[
            { value: 'week', label: t('dash.week') },
            { value: 'month', label: t('dash.month') },
          ]}
        />
      </div>
      {view === 'week' ? (
        <WeekView
          cursor={cursor}
          today={today}
          bookings={bookings}
          onSelect={onSelect}
          selectedId={selectedId}
          intl={intl}
        />
      ) : (
        <MonthView
          cursor={cursor}
          today={today}
          bookings={bookings}
          onSelect={onSelect}
          intl={intl}
        />
      )}
    </div>
  );
}

function WeekView({
  cursor,
  today,
  bookings,
  onSelect,
  selectedId,
  intl,
}: {
  cursor: Date;
  today: Date;
  bookings: Booking[];
  onSelect: (booking: Booking) => void;
  selectedId: string | null;
  intl: string;
}) {
  const { locale } = useT();
  const start = startOfWeek(cursor);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const hours = Array.from({ length: HOURS.end - HOURS.start }, (_, i) => HOURS.start + i);
  const nowTop =
    ((today.getHours() + today.getMinutes() / 60 - HOURS.start) / (HOURS.end - HOURS.start)) * 100;
  return (
    <div className="scroll-quiet overflow-x-auto">
      <div className="grid min-w-[640px] grid-cols-[52px_repeat(7,1fr)]">
        <div className="border-b border-border" />
        {days.map((day) => {
          const isToday = isSameDay(day, today);
          return (
            <div
              key={day.toISOString()}
              className="border-b border-l border-border px-2 py-2 text-center"
            >
              <p className="text-[11px] uppercase tracking-wider text-subtle">
                {new Intl.DateTimeFormat(intl, { weekday: 'short' }).format(day)}
              </p>
              <p
                className={cn(
                  'mx-auto mt-0.5 flex size-7 items-center justify-center rounded-full text-sm font-semibold',
                  isToday && 'bg-primary text-white',
                )}
              >
                {day.getDate()}
              </p>
            </div>
          );
        })}
        <div className="relative" style={{ height: hours.length * HOUR_HEIGHT }}>
          {hours.map((hour, i) => (
            <span
              key={hour}
              className="absolute right-2 -translate-y-1/2 text-[10px] tabular-nums text-subtle"
              style={{ top: i * HOUR_HEIGHT }}
            >
              {i === 0 ? '' : `${hour}:00`}
            </span>
          ))}
        </div>
        {days.map((day) => {
          const isToday = isSameDay(day, today);
          const dayBookings = bookings.filter((b) => isSameDay(new Date(b.slot.startsAt), day));
          return (
            <div
              key={day.toISOString()}
              className={cn('relative border-l border-border', isToday && 'bg-primary-soft/25')}
              style={{ height: hours.length * HOUR_HEIGHT }}
            >
              {hours.map((hour, i) => (
                <div
                  key={hour}
                  className="absolute inset-x-0 border-t border-border/70"
                  style={{ top: i * HOUR_HEIGHT }}
                />
              ))}
              {isToday && nowTop > 0 && nowTop < 100 ? (
                <div
                  className="absolute inset-x-0 z-10 flex items-center"
                  style={{ top: `${nowTop}%` }}
                >
                  <span className="-ml-1 size-2 rounded-full bg-destructive" />
                  <span className="h-px flex-1 bg-destructive" />
                </div>
              ) : null}
              {dayBookings.map((booking) => {
                const startDate = new Date(booking.slot.startsAt);
                const top =
                  ((startDate.getHours() + startDate.getMinutes() / 60 - HOURS.start) /
                    (HOURS.end - HOURS.start)) *
                  100;
                const height = Math.max(
                  HOUR_HEIGHT * 0.9,
                  ((new Date(booking.slot.endsAt).getTime() - startDate.getTime()) / 3_600_000) *
                    HOUR_HEIGHT,
                );
                const cancelled = booking.status === 'cancelled';
                return (
                  <button
                    key={booking.id}
                    type="button"
                    onClick={() => onSelect(booking)}
                    className={cn(
                      'absolute inset-x-1 z-20 overflow-hidden rounded-lg border-l-[3px] px-2 py-1 text-left text-[11px] leading-4 shadow-sm transition-all hover:shadow-md',
                      cancelled
                        ? 'border-subtle bg-muted text-muted-foreground line-through'
                        : booking.provider.telehealth
                          ? 'border-violet bg-violet-soft text-violet'
                          : 'border-primary bg-primary-soft text-primary-strong',
                      selectedId === booking.id && 'ring-2 ring-primary/40',
                    )}
                    style={{ top: `${top}%`, height }}
                  >
                    <p className="flex items-center gap-1 font-semibold tabular-nums">
                      {booking.provider.telehealth ? <Video size={11} aria-hidden="true" /> : null}
                      {formatTime(booking.slot.startsAt, locale)}
                    </p>
                    <p className="truncate">{booking.provider.name.replace(' (demo)', '')}</p>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MonthView({
  cursor,
  today,
  bookings,
  onSelect,
  intl,
}: {
  cursor: Date;
  today: Date;
  bookings: Booking[];
  onSelect: (booking: Booking) => void;
  intl: string;
}) {
  const { locale } = useT();
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const gridStart = startOfWeek(first);
  const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  return (
    <div className="grid grid-cols-7">
      {cells.slice(0, 7).map((day) => (
        <p
          key={day.toISOString()}
          className="border-b border-border py-2 text-center text-[11px] uppercase tracking-wider text-subtle"
        >
          {new Intl.DateTimeFormat(intl, { weekday: 'short' }).format(day)}
        </p>
      ))}
      {cells.map((day) => {
        const inMonth = day.getMonth() === cursor.getMonth();
        const isToday = isSameDay(day, today);
        const dayBookings = bookings.filter((b) => isSameDay(new Date(b.slot.startsAt), day));
        return (
          <div
            key={day.toISOString()}
            className={cn(
              'min-h-[84px] border-b border-l border-border p-1.5 first:border-l-0 [&:nth-child(7n+8)]:border-l-0',
              !inMonth && 'bg-muted/40',
            )}
          >
            <p
              className={cn(
                'mb-1 flex size-6 items-center justify-center rounded-full text-xs',
                isToday
                  ? 'bg-primary font-semibold text-white'
                  : inMonth
                    ? 'text-foreground'
                    : 'text-subtle',
              )}
            >
              {day.getDate()}
            </p>
            <div className="space-y-1">
              {dayBookings.map((booking) => (
                <button
                  key={booking.id}
                  type="button"
                  onClick={() => onSelect(booking)}
                  className={cn(
                    'w-full truncate rounded-md px-1.5 py-0.5 text-left text-[11px] font-medium',
                    booking.status === 'cancelled'
                      ? 'bg-muted text-muted-foreground line-through'
                      : booking.provider.telehealth
                        ? 'bg-violet-soft text-violet'
                        : 'bg-primary-soft text-primary-strong',
                  )}
                >
                  {formatTime(booking.slot.startsAt, locale)}{' '}
                  {booking.provider.name.replace(' (demo)', '')}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
