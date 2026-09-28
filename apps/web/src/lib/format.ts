import type { CostRange } from '@bupa/contracts';
import type { Locale } from '@/i18n';

const intl = (locale: Locale) => (locale === 'zh' ? 'zh-CN' : 'en-AU');

export function formatMoneyRange(
  range: CostRange | null,
  locale: Locale,
  free: string,
  unknown: string,
) {
  if (!range) return unknown;
  if (range.max === 0) return free;
  const fmt = new Intl.NumberFormat(intl(locale), {
    style: 'currency',
    currency: range.currency,
    maximumFractionDigits: 0,
  });
  if (range.min === range.max) return fmt.format(range.max);
  return `${fmt.format(range.min)} – ${fmt.format(range.max)}`;
}

export function formatDate(iso: string, locale: Locale, options?: Intl.DateTimeFormatOptions) {
  const date = new Date(iso);
  return new Intl.DateTimeFormat(intl(locale), {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...options,
  }).format(date);
}

export function formatTime(iso: string, locale: Locale) {
  return new Intl.DateTimeFormat(intl(locale), { hour: 'numeric', minute: '2-digit' }).format(
    new Date(iso),
  );
}

export function formatDateTime(iso: string, locale: Locale) {
  return `${formatDate(iso, locale)} · ${formatTime(iso, locale)}`;
}

export function formatDayLabel(iso: string, locale: Locale, today: string, tomorrow: string) {
  const date = new Date(iso);
  const now = new Date();
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  if (sameDay(date, now)) return today;
  const next = new Date(now);
  next.setDate(now.getDate() + 1);
  if (sameDay(date, next)) return tomorrow;
  return formatDate(iso, locale);
}

export function formatRelativeDays(isoDate: string, locale: Locale) {
  const target = new Date(`${isoDate}T00:00:00`);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const days = Math.round((target.getTime() - now.getTime()) / 86_400_000);
  const rtf = new Intl.RelativeTimeFormat(intl(locale), { numeric: 'auto' });
  return rtf.format(days, 'day');
}

export function languageName(code: string, locale: Locale) {
  const names: Record<string, { en: string; zh: string }> = {
    en: { en: 'English', zh: '英语' },
    'zh-CN': { en: 'Mandarin', zh: '中文' },
    vi: { en: 'Vietnamese', zh: '越南语' },
    other: { en: 'Other', zh: '其他' },
  };
  return names[code]?.[locale] ?? code;
}

export function startOfWeek(date: Date) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const day = (start.getDay() + 6) % 7; // Monday first
  start.setDate(start.getDate() - day);
  return start;
}

export function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
