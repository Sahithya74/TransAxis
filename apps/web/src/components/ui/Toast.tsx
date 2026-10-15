import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { CheckCircle2, AlertTriangle, X } from 'lucide-react';

interface ToastItem {
  id: number;
  kind: 'success' | 'error';
  message: string;
}

const ToastContext = createContext<((kind: ToastItem['kind'], message: string) => void) | null>(null);
let seq = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const dismiss = (id: number) => setItems((all) => all.filter((t) => t.id !== id));
  const push = useCallback((kind: ToastItem['kind'], message: string) => {
    const id = ++seq;
    setItems((all) => [...all.slice(-3), { id, kind, message }]);
    setTimeout(() => dismiss(id), kind === 'error' ? 8000 : 4000);
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[min(24rem,calc(100%-2rem))] flex-col gap-2">
        {items.map((t) => (
          <div
            key={t.id}
            role={t.kind === 'error' ? 'alert' : 'status'}
            className={`pointer-events-auto flex items-start gap-2 rounded-lg border bg-surface px-3 py-2.5 text-[13px] shadow-[0_4px_6px_-1px_rgb(15_23_42/0.08)] ${
              t.kind === 'error' ? 'border-crit/40' : 'border-ok/40'
            }`}
          >
            {t.kind === 'error' ? (
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-crit" aria-hidden />
            ) : (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" aria-hidden />
            )}
            <span className="flex-1">{t.message}</span>
            <button onClick={() => dismiss(t.id)} aria-label="Dismiss" className="text-muted hover:text-ink">
              <X className="size-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const push = useContext(ToastContext);
  if (!push) throw new Error('useToast must be used inside <ToastProvider>');
  return { success: (m: string) => push('success', m), error: (m: string) => push('error', m) };
}
