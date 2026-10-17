import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

/** Right-hand side panel on the native <dialog> element (focus trap and Esc for free). */
export function Drawer({
  open,
  onClose,
  title,
  description,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
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
      aria-labelledby="drawer-title"
      className="m-0 ml-auto h-dvh max-h-dvh w-full max-w-2xl border-l border-line bg-surface p-0 text-ink shadow-[0_20px_25px_-5px_rgb(15_23_42/0.12)] backdrop:bg-chrome/40"
    >
      {open && (
        <div className="flex h-full flex-col">
          <div className="flex items-start gap-3 border-b border-line px-5 py-4">
            <div className="min-w-0 flex-1">
              <h2 id="drawer-title" className="text-base">{title}</h2>
              {description && <div className="mt-0.5 text-[13px] text-muted">{description}</div>}
            </div>
            <button onClick={onClose} aria-label="Close" className="rounded p-1 text-muted hover:bg-subtle hover:text-ink">
              <X className="size-4" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex justify-end gap-2 border-t border-line bg-canvas px-5 py-3">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}
