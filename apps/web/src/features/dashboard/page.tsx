import {
  Bell,
  Building2,
  CalendarDays,
  CalendarPlus,
  ClipboardList,
  Languages,
  MapPin,
  Navigation,
  Plus,
  ReceiptText,
  Sparkles,
  StickyNote,
  Video,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Booking } from '@bupa/contracts';
import { Button } from '@/components/ui/button';
import {
  Badge,
  Card,
  Dialog,
  EmptyState,
  Input,
  SectionHeading,
  Switch,
} from '@/components/ui/primitives';
import { toast } from '@/components/ui/toast';
import { useT } from '@/i18n';
import { api } from '@/lib/api';
import {
  formatDateTime,
  formatDayLabel,
  formatMoneyRange,
  formatRelativeDays,
  formatTime,
  languageName,
} from '@/lib/format';
import { keys, invalidateAll } from '@/lib/query';
import { cn } from '@/lib/utils';
import { useChat } from '@/stores/chat';
import { useNavigation } from '@/stores/navigation';
import { useWizard } from '@/stores/wizard';
import { WizardPanel } from '@/features/wizard/panel';
import { Calendar } from './calendar';
import { HealthOverview } from './health-overview';
import { HealthSuggestions } from './health-suggestions';

export function DashboardPage() {
  const { t, tx, locale } = useT();
  const schedule = useQuery({ queryKey: keys.schedule, queryFn: api.schedule });
  const receipts = useQuery({ queryKey: keys.receipts, queryFn: api.receipts });
  const overview = useQuery({
    queryKey: keys.healthOverview,
    queryFn: api.healthOverview,
    enabled: api.features.personalization,
  });
  const personalization = useQuery({
    queryKey: keys.personalization,
    queryFn: api.personalization,
    enabled: api.features.personalization,
  });
  const { openDraftId, host, open: openWizard } = useWizard();
  const { focusBookingId, focusBooking, navigate } = useNavigation();
  const send = useChat((s) => s.send);
  const [selected, setSelected] = useState<Booking | null>(null);

  useEffect(() => {
    if (!focusBookingId || !schedule.data) return;
    const booking = schedule.data.bookings.find((b) => b.id === focusBookingId);
    if (booking) setSelected(booking);
    focusBooking(null);
  }, [focusBookingId, schedule.data, focusBooking]);

  const startBooking = async (rescheduleOf?: string) => {
    const draft = await api.createDraft({ rescheduleOf: rescheduleOf ?? null });
    invalidateAll();
    openWizard(draft.id, 'dashboard');
  };
  // Policy cards start a fresh conversation so they never land in an unrelated old topic.
  const askAgent = async (prompt: string) => {
    navigate('chat');
    await useChat.getState().startNew();
    void send(prompt);
  };

  const bookings = schedule.data?.bookings ?? [];
  const upcoming = bookings
    .filter((b) => b.status === 'confirmed' && new Date(b.slot.endsAt) >= new Date())
    .sort((a, b) => a.slot.startsAt.localeCompare(b.slot.startsAt));
  const cards = schedule.data?.cards.filter((c) => !c.dismissed) ?? [];
  const drafts = schedule.data?.drafts ?? [];
  const wizardOpen = openDraftId !== null && host === 'dashboard';

  return (
    <div className="relative h-full">
      <div className="scroll-quiet h-full overflow-y-auto">
        <div className="mx-auto max-w-[1200px] px-8 py-8">
          <div className="flex items-end justify-between gap-6">
            <div>
              <h1 className="text-[26px] font-semibold tracking-tight">{t('dash.health')}</h1>
              <p className="mt-1.5 text-sm text-muted-foreground">{t('dash.subtitle')}</p>
            </div>
            <Button size="lg" onClick={() => void startBooking()}>
              <Plus size={18} aria-hidden="true" /> {t('dash.newBooking')}
            </Button>
          </div>

          {/* ------------------------------------------- Health overview + suggestions */}
          <div className="mt-6 space-y-5">
            <HealthOverview
              query={overview}
              presetByDemo={personalization.data?.presetByDemo ?? false}
            />
            {overview.data ? <HealthSuggestions overview={overview.data} /> : null}
          </div>

          <SectionHeading title={t('dash.title')} className="mt-8" />
          <div className="mt-3 grid grid-cols-3 gap-3">
            {[
              { icon: CalendarDays, label: t('dash.stats.bookings'), value: upcoming.length },
              {
                icon: Bell,
                label: t('dash.stats.reminders'),
                value: schedule.data?.reminders.filter((r) => r.enabled).length ?? 0,
              },
              {
                icon: ReceiptText,
                label: t('dash.stats.receipts'),
                value: receipts.data?.length ?? 0,
              },
            ].map(({ icon: Icon, label, value }) => (
              <Card key={label} className="flex items-center gap-4 px-5 py-4">
                <div className="flex size-10 items-center justify-center rounded-xl bg-primary-soft text-primary">
                  <Icon size={18} aria-hidden="true" />
                </div>
                <div>
                  <p className="text-2xl font-semibold tabular-nums leading-none">{value}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{label}</p>
                </div>
              </Card>
            ))}
          </div>

          <div className="mt-6 grid grid-cols-[1fr_340px] gap-6">
            {/* ------------------------------------------------- Left column */}
            <div className="min-w-0 space-y-6">
              {cards.length ? (
                <section aria-label={t('dash.cards')}>
                  <p className="mb-2.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-subtle">
                    <Sparkles size={12} aria-hidden="true" /> {t('dash.cards')}
                    <span className="font-normal normal-case tracking-normal text-subtle/80">
                      · {t('dash.cardsHint')}
                    </span>
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    {cards.map((card) => (
                      <Card
                        key={card.id}
                        className="group relative overflow-hidden p-4 transition-shadow hover:shadow-md"
                      >
                        <div
                          className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-primary to-violet"
                          aria-hidden="true"
                        />
                        <div className="flex items-start justify-between gap-3 pl-2">
                          <div>
                            <Badge tone={card.kind === 'waiting_period' ? 'warning' : 'primary'}>
                              {formatRelativeDays(card.dueAt, locale)}
                            </Badge>
                            <p className="mt-2 text-sm font-semibold leading-5">{tx(card.title)}</p>
                            <p className="mt-1 text-xs leading-5 text-muted-foreground">
                              {tx(card.body)}
                            </p>
                          </div>
                          <button
                            type="button"
                            aria-label={t('dash.dismiss')}
                            onClick={() => api.dismissCard(card.id).then(invalidateAll)}
                            className="rounded-full p-1 text-subtle opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100"
                          >
                            <X size={14} />
                          </button>
                        </div>
                        <Button
                          size="sm"
                          variant="soft"
                          className="ml-2 mt-3"
                          onClick={() => void askAgent(tx(card.prompt))}
                        >
                          <Sparkles size={13} aria-hidden="true" /> {t('dash.askAgent')}
                        </Button>
                      </Card>
                    ))}
                  </div>
                </section>
              ) : null}

              <Calendar
                bookings={bookings}
                onSelect={setSelected}
                selectedId={selected?.id ?? null}
              />
            </div>

            {/* ------------------------------------------------ Right column */}
            <div className="space-y-5">
              {drafts.length ? (
                <section>
                  <SectionHeading title={t('dash.drafts')} className="mb-2.5" />
                  {drafts.map((draft) => (
                    <Card key={draft.id} className="flex items-center gap-3 border-dashed p-3.5">
                      <ClipboardList size={18} className="text-primary" aria-hidden="true" />
                      <div className="min-w-0 flex-1 text-sm">
                        <p className="font-medium">
                          {t('dash.draftStep')} {draft.step} / 5
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {String(draft.fields.need?.value ?? '') ||
                            t(
                              `service.${String(draft.fields.serviceType?.value ?? 'gp')}` as 'service.gp',
                            )}
                        </p>
                      </div>
                      <Button size="sm" onClick={() => openWizard(draft.id, 'dashboard')}>
                        {t('wizard.resume')}
                      </Button>
                      <button
                        type="button"
                        aria-label={t('dash.discardDraft')}
                        onClick={() => api.abandonDraft(draft.id).then(invalidateAll)}
                        className="rounded-full p-1 text-subtle hover:bg-muted hover:text-foreground"
                      >
                        <X size={14} />
                      </button>
                    </Card>
                  ))}
                </section>
              ) : null}

              <section>
                <SectionHeading title={t('dash.upcoming')} className="mb-2.5" />
                {upcoming.length ? (
                  <div className="space-y-2.5">
                    {upcoming.map((booking) => (
                      <BookingCard
                        key={booking.id}
                        booking={booking}
                        onOpen={() => setSelected(booking)}
                        active={selected?.id === booking.id}
                      />
                    ))}
                  </div>
                ) : (
                  <EmptyState
                    icon={<CalendarPlus size={20} aria-hidden="true" />}
                    title={t('dash.noUpcoming')}
                    body={t('dash.noUpcomingBody')}
                    action={
                      <div className="flex gap-2">
                        <Button size="sm" variant="soft" onClick={() => navigate('chat')}>
                          <Sparkles size={13} aria-hidden="true" /> {t('dash.askAgent')}
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => void startBooking()}>
                          {t('dash.newBooking')}
                        </Button>
                      </div>
                    }
                  />
                )}
              </section>

              <RemindersSection />
              <NotesSection />
            </div>
          </div>
        </div>
      </div>

      <BookingDialog
        booking={selected}
        onClose={() => setSelected(null)}
        onReschedule={(id) => void startBooking(id)}
      />

      {/* Wizard drawer (opened from this page) */}
      {wizardOpen && openDraftId ? (
        <div className="absolute inset-0 z-40 flex justify-end">
          <button
            type="button"
            aria-label={t('common.close')}
            onClick={() => useWizard.getState().close()}
            className="absolute inset-0 animate-fade-in bg-foreground/25 backdrop-blur-[1px]"
          />
          <div className="relative h-full w-[520px] border-l border-border bg-card shadow-lg">
            <WizardPanel draftId={openDraftId} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function BookingCard({
  booking,
  onOpen,
  active,
}: {
  booking: Booking;
  onOpen: () => void;
  active: boolean;
}) {
  const { t, locale } = useT();
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'w-full rounded-2xl border bg-card p-4 text-left shadow-sm transition-all hover:-translate-y-px hover:shadow-md',
        active ? 'border-primary ring-2 ring-primary/20' : 'border-border',
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            'flex size-10 shrink-0 flex-col items-center justify-center rounded-xl text-white',
            booking.provider.telehealth ? 'bg-violet' : 'bg-primary',
          )}
        >
          {booking.provider.telehealth ? (
            <Video size={16} aria-hidden="true" />
          ) : (
            <Building2 size={16} aria-hidden="true" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-primary-strong">
            {formatDayLabel(booking.slot.startsAt, locale, t('common.today'), t('common.tomorrow'))}{' '}
            · {formatTime(booking.slot.startsAt, locale)}
          </p>
          <p className="mt-0.5 truncate text-sm font-semibold">
            {booking.provider.name.replace(' (demo)', '')}
          </p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {t(`service.${booking.service}`)} · {booking.need}
          </p>
        </div>
        <Badge tone="success">{t('dash.confirmed')}</Badge>
      </div>
    </button>
  );
}

function BookingDialog({
  booking,
  onClose,
  onReschedule,
}: {
  booking: Booking | null;
  onClose: () => void;
  onReschedule: (id: string) => void;
}) {
  const { t, locale } = useT();
  const [confirmCancel, setConfirmCancel] = useState(false);
  useEffect(() => setConfirmCancel(false), [booking?.id]);
  if (!booking) return null;
  const cancelled = booking.status === 'cancelled';
  const cancel = async () => {
    await api.cancelBooking(booking.id);
    invalidateAll();
    toast({ title: t('dash.cancelled'), body: booking.provider.name, tone: 'receipt' });
    onClose();
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={booking.provider.name.replace(' (demo)', '')}
      description={formatDateTime(booking.slot.startsAt, locale)}
      footer={
        cancelled ? (
          <Button variant="outline" onClick={onClose}>
            {t('common.close')}
          </Button>
        ) : confirmCancel ? (
          <>
            <Button variant="ghost" onClick={() => setConfirmCancel(false)}>
              {t('common.back')}
            </Button>
            <Button variant="destructive" onClick={() => void cancel()}>
              {t('dash.cancelBooking')}
            </Button>
          </>
        ) : (
          <>
            <Button variant="destructiveGhost" onClick={() => setConfirmCancel(true)}>
              {t('dash.cancelBooking')}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                onClose();
                onReschedule(booking.id);
              }}
            >
              {t('dash.reschedule')}
            </Button>
          </>
        )
      }
    >
      {confirmCancel ? (
        <p className="rounded-lg bg-destructive-soft px-3.5 py-3 text-sm text-destructive">
          {t('dash.cancelConfirm')}
        </p>
      ) : (
        <div className="space-y-4 text-sm">
          <div className="flex flex-wrap gap-2">
            <Badge tone={cancelled ? 'neutral' : 'success'}>
              {cancelled ? t('dash.cancelled') : t('dash.confirmed')}
            </Badge>
            <Badge tone={booking.provider.relationship === 'bupa_owned' ? 'primary' : 'neutral'}>
              {t(`relationship.${booking.provider.relationship}`)}
            </Badge>
            <Badge>{t(`service.${booking.service}`)}</Badge>
          </div>
          <dl className="grid grid-cols-[130px_1fr] gap-x-4 gap-y-2.5">
            <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <MapPin size={13} aria-hidden="true" />{' '}
              {booking.provider.telehealth ? t('common.online') : t('dash.directions')}
            </dt>
            <dd className="flex items-center justify-between gap-3">
              <span>{booking.provider.address}</span>
              {!booking.provider.telehealth ? (
                <a
                  className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-primary hover:underline"
                  href={`https://www.google.com/maps/search/${encodeURIComponent(booking.provider.address)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Navigation size={12} aria-hidden="true" /> {t('dash.directions')}
                </a>
              ) : null}
            </dd>
            <dt className="text-xs text-muted-foreground">{t('dash.outOfPocket')}</dt>
            <dd className={cn('font-semibold', booking.outOfPocket?.max === 0 && 'text-success')}>
              {formatMoneyRange(
                booking.outOfPocket,
                locale,
                t('common.free'),
                t('common.unknownCost'),
              )}
            </dd>
            <dt className="text-xs text-muted-foreground">{t('profile.field.name')}</dt>
            <dd>{booking.patientName}</dd>
            <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Languages size={13} aria-hidden="true" /> {t('profile.field.preferredLanguage')}
            </dt>
            <dd>
              {booking.language ? languageName(booking.language, locale) : '—'}
              {booking.interpreter ? ` · ${t('profile.field.interpreter')}` : ''}
            </dd>
            <dt className="text-xs text-muted-foreground">{t('dash.whatToBring')}</dt>
            <dd>
              <ul className="space-y-1">
                {booking.whatToBring.map((item) => (
                  <li key={item} className="flex items-start gap-2">
                    <span
                      aria-hidden="true"
                      className="mt-[7px] size-1.5 shrink-0 rounded-full bg-primary"
                    />{' '}
                    {item}
                  </li>
                ))}
              </ul>
            </dd>
          </dl>
        </div>
      )}
    </Dialog>
  );
}

function RemindersSection() {
  const { t, locale } = useT();
  const schedule = useQuery({ queryKey: keys.schedule, queryFn: api.schedule });
  const reminders = [...(schedule.data?.reminders ?? [])].sort((a, b) => a.at.localeCompare(b.at));
  return (
    <section>
      <SectionHeading title={t('dash.reminders')} className="mb-2.5" />
      {reminders.length ? (
        <Card className="divide-y divide-border">
          {reminders.map((reminder) => (
            <div key={reminder.id} className="flex items-center gap-3 px-4 py-3">
              <Bell
                size={15}
                className={cn(reminder.enabled ? 'text-primary' : 'text-subtle')}
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    'truncate text-sm',
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
            </div>
          ))}
        </Card>
      ) : (
        <p className="rounded-xl border border-dashed border-border px-4 py-5 text-center text-xs text-muted-foreground">
          {t('dash.noReminders')}
        </p>
      )}
    </section>
  );
}

function NotesSection() {
  const { t } = useT();
  const schedule = useQuery({ queryKey: keys.schedule, queryFn: api.schedule });
  const [text, setText] = useState('');
  const notes = schedule.data?.notes ?? [];
  const bookingFor = (id: string | null) => schedule.data?.bookings.find((b) => b.id === id);
  const add = async () => {
    if (!text.trim()) return;
    const latest = schedule.data?.bookings.find((b) => b.status === 'confirmed');
    await api.createNote({ bookingId: latest?.id ?? null, text: text.trim() });
    setText('');
    invalidateAll();
  };
  return (
    <section>
      <SectionHeading title={t('dash.notes')} className="mb-2.5" />
      <Card className="p-3">
        {notes.length ? (
          <ul className="mb-3 space-y-2">
            {notes.map((note) => (
              <li key={note.id} className="rounded-lg bg-muted/60 px-3 py-2 text-sm">
                <p className="leading-5">{note.text}</p>
                <p className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
                  {note.createdBy === 'ai' ? (
                    <Sparkles size={11} aria-hidden="true" />
                  ) : (
                    <StickyNote size={11} aria-hidden="true" />
                  )}
                  {t(`dash.by.${note.createdBy}`)}
                  {bookingFor(note.bookingId)
                    ? ` · ${bookingFor(note.bookingId)?.provider.name.replace(' (demo)', '')}`
                    : ''}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mb-3 px-1 text-xs text-muted-foreground">{t('dash.noNotes')}</p>
        )}
        <div className="flex gap-2">
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t('dash.notePlaceholder')}
            aria-label={t('dash.addNote')}
            onKeyDown={(e) => e.key === 'Enter' && void add()}
            className="h-9 py-1.5"
          />
          <Button size="sm" variant="soft" onClick={() => void add()} disabled={!text.trim()}>
            {t('dash.addNote')}
          </Button>
        </div>
      </Card>
    </section>
  );
}
