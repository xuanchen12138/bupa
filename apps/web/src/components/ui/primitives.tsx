import { X } from 'lucide-react';
import {
  useEffect,
  useId,
  useRef,
  type ComponentProps,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { cn } from '@/lib/utils';
import { useT } from '@/i18n';

/* ---------------------------------------------------------------- Card */
export function Card({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn('rounded-2xl border border-border bg-card shadow-sm', className)}
      {...props}
    />
  );
}

export function SectionHeading({
  title,
  hint,
  action,
  className,
}: {
  title: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-start justify-between gap-6', className)}>
      <div>
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        {hint ? <p className="mt-1 text-sm leading-6 text-muted-foreground">{hint}</p> : null}
      </div>
      {action}
    </div>
  );
}

/* --------------------------------------------------------------- Badge */
type Tone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'violet';
const tones: Record<Tone, string> = {
  neutral: 'bg-muted text-muted-foreground',
  primary: 'bg-primary-soft text-primary-strong',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-destructive-soft text-destructive',
  violet: 'bg-violet-soft text-violet',
};
export function Badge({
  tone = 'neutral',
  className,
  ...props
}: ComponentProps<'span'> & { tone?: Tone }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold leading-5 tracking-wide',
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}

/* ----------------------------------------------------------- SourceTag */
export function SourceTag({
  source,
  className,
}: {
  source: 'conversation' | 'profile' | 'cover' | 'user';
  className?: string;
}) {
  const { t } = useT();
  const tone: Tone =
    source === 'conversation'
      ? 'violet'
      : source === 'profile'
        ? 'primary'
        : source === 'cover'
          ? 'success'
          : 'neutral';
  return (
    <Badge tone={tone} className={cn('font-medium', className)}>
      <span className="size-1.5 rounded-full bg-current opacity-70" aria-hidden="true" />
      {t(`source.${source}`)}
    </Badge>
  );
}

/* -------------------------------------------------------------- Switch */
export function Switch({
  checked,
  onCheckedChange,
  disabled,
  label,
  className,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  label?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50',
        checked ? 'bg-primary' : 'bg-border-strong',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'absolute left-0.5 size-5 rounded-full bg-white shadow-sm transition-transform duration-200',
          checked ? 'translate-x-5' : 'translate-x-0',
        )}
      />
    </button>
  );
}

/* ----------------------------------------------------------- Segmented */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  size = 'sm',
  className,
  label,
}: {
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: ReactNode; tone?: 'danger' }>;
  size?: 'sm' | 'md';
  className?: string;
  label?: string;
}) {
  const handleKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = options.findIndex((option) => option.value === value);
    if (event.key === 'ArrowRight') onChange(options[(index + 1) % options.length]!.value);
    if (event.key === 'ArrowLeft')
      onChange(options[(index - 1 + options.length) % options.length]!.value);
  };
  return (
    <div
      role="radiogroup"
      aria-label={label}
      onKeyDown={handleKey}
      className={cn('inline-flex rounded-lg bg-muted p-0.5', className)}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(option.value)}
            className={cn(
              'rounded-md font-medium transition-all duration-150 focus-visible:outline-2 focus-visible:outline-ring',
              size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-1.5 text-sm',
              active
                ? cn(
                    'bg-card shadow-sm',
                    option.tone === 'danger' ? 'text-destructive' : 'text-foreground',
                  )
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/* --------------------------------------------------------------- Field */
export function FieldLabel({
  children,
  htmlFor,
  required,
  trailing,
}: {
  children: ReactNode;
  htmlFor?: string;
  required?: boolean;
  trailing?: ReactNode;
}) {
  return (
    <div className="mb-1.5 flex items-center justify-between gap-3">
      <label htmlFor={htmlFor} className="text-sm font-medium text-foreground">
        {children}
        {required ? (
          <span className="ml-0.5 text-destructive" aria-hidden="true">
            *
          </span>
        ) : null}
      </label>
      {trailing}
    </div>
  );
}

export const inputClass =
  'w-full rounded-lg border border-input bg-card px-3.5 py-2.5 text-sm text-foreground shadow-xs transition-colors placeholder:text-subtle hover:border-border-strong focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/15 disabled:bg-muted disabled:text-muted-foreground aria-invalid:border-destructive aria-invalid:ring-destructive/15';

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input className={cn(inputClass, className)} {...props} />;
}
export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea className={cn(inputClass, 'min-h-[88px] resize-y', className)} {...props} />;
}
export function Select({ className, ...props }: ComponentProps<'select'>) {
  return (
    <select
      className={cn(
        inputClass,
        'appearance-none bg-[url("data:image/svg+xml;utf8,<svg xmlns=%27http://www.w3.org/2000/svg%27 width=%2716%27 height=%2716%27 viewBox=%270 0 24 24%27 fill=%27none%27 stroke=%27%235b6f80%27 stroke-width=%272%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27><polyline points=%276 9 12 15 18 9%27/></svg>")] bg-[length:16px_16px] bg-[right_12px_center] bg-no-repeat pr-10',
        className,
      )}
      {...props}
    />
  );
}

/* ------------------------------------------------------------ Skeleton */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse-soft rounded-lg bg-muted', className)} />;
}

/* -------------------------------------------------------------- Dialog */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  width?: 'md' | 'lg';
}) {
  const { t } = useT();
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    panelRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      previous?.focus();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <button
        type="button"
        aria-label={t('common.close')}
        onClick={onClose}
        className="absolute inset-0 animate-fade-in bg-foreground/35 backdrop-blur-[2px]"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          'relative w-full animate-pop rounded-2xl border border-border bg-card shadow-lg focus:outline-none',
          width === 'lg' ? 'max-w-2xl' : 'max-w-lg',
        )}
      >
        <div className="flex items-start justify-between gap-4 px-6 pt-6">
          <div>
            <h2 id={titleId} className="text-lg font-semibold tracking-tight">
              {title}
            </h2>
            {description ? (
              <p className="mt-1 text-sm text-muted-foreground">{description}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X size={18} />
          </button>
        </div>
        {children ? <div className="px-6 py-5">{children}</div> : null}
        {footer ? (
          <div className="flex justify-end gap-2 border-t border-border px-6 py-4">{footer}</div>
        ) : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ EmptyState */
export function EmptyState({
  icon,
  title,
  body,
  action,
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  body?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center rounded-2xl border border-dashed border-border-strong px-6 py-10 text-center',
        className,
      )}
    >
      {icon ? (
        <div className="mb-3 flex size-11 items-center justify-center rounded-full bg-primary-soft text-primary">
          {icon}
        </div>
      ) : null}
      <p className="font-semibold">{title}</p>
      {body ? <p className="mt-1 max-w-sm text-sm text-muted-foreground">{body}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
