import { CheckCircle2, Info, ShieldCheck, X } from 'lucide-react';
import { create } from 'zustand';
import { cn } from '@/lib/utils';

export type Toast = {
  id: string;
  title: string;
  body?: string;
  tone?: 'info' | 'success' | 'receipt';
  action?: { label: string; onClick: () => void };
};

type ToastState = {
  toasts: Toast[];
  push: (toast: Omit<Toast, 'id'>) => void;
  dismiss: (id: string) => void;
};

export const useToasts = create<ToastState>((set) => ({
  toasts: [],
  push: (toast) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    set((state) => ({ toasts: [...state.toasts.slice(-3), { ...toast, id }] }));
    setTimeout(() => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })), 5500);
  },
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));

export const toast = (input: Omit<Toast, 'id'>) => useToasts.getState().push(input);

const icons = {
  info: <Info size={18} className="text-primary" />,
  success: <CheckCircle2 size={18} className="text-success" />,
  receipt: <ShieldCheck size={18} className="text-primary" />,
};

export function ToastViewport() {
  const { toasts, dismiss } = useToasts();
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed bottom-6 right-6 z-[60] flex w-80 flex-col gap-2"
    >
      {toasts.map((item) => (
        <div
          key={item.id}
          className={cn(
            'pointer-events-auto flex animate-fade-up items-start gap-3 rounded-xl border border-border bg-card p-3.5 shadow-lg',
          )}
        >
          <div className="mt-0.5 shrink-0">{icons[item.tone ?? 'info']}</div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold leading-5">{item.title}</p>
            {item.body ? (
              <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{item.body}</p>
            ) : null}
            {item.action ? (
              <button
                type="button"
                onClick={() => {
                  item.action?.onClick();
                  dismiss(item.id);
                }}
                className="mt-1.5 text-xs font-semibold text-primary hover:underline"
              >
                {item.action.label}
              </button>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => dismiss(item.id)}
            className="rounded-full p-1 text-subtle hover:bg-muted hover:text-foreground"
            aria-label="Dismiss"
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
