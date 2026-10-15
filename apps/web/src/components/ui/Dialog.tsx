import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: 'md' | 'lg';
}

/**
 * Modal built on the native <dialog> element: the browser provides focus trapping, Esc to close and
 * an inert background, which keeps it accessible without extra dependencies.
 */
export function Dialog({ open, onClose, title, description, children, footer, width = 'md' }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      aria-labelledby="dialog-title"
      className={`m-auto w-[calc(100%-2rem)] ${width === 'lg' ? 'max-w-2xl' : 'max-w-lg'} rounded-lg border border-line bg-surface p-0 text-ink shadow-[0_20px_25px_-5px_rgb(15_23_42/0.12),0_8px_10px_-6px_rgb(15_23_42/0.06)] backdrop:bg-chrome/40`}
    >
      {open && (
        <div className="flex max-h-[85vh] flex-col">
          <div className="flex items-start gap-3 border-b border-line px-5 py-4">
            <div className="min-w-0 flex-1">
              <h2 id="dialog-title" className="text-base">{title}</h2>
              {description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}
            </div>
            <button onClick={onClose} aria-label="Close" className="rounded p-1 text-muted hover:bg-subtle hover:text-ink">
              <X className="size-4" />
            </button>
          </div>
          <div className="overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex justify-end gap-2 border-t border-line bg-canvas px-5 py-3">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}
