import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Button } from './ui/Button';
import { Dialog } from './ui/Dialog';
import { Field, Textarea } from './ui/Field';
import { apiFieldErrors } from '../lib/forms';

/**
 * Confirms an action that may need a written reason (hold, cancel, override). The caller performs the
 * request; errors from it are shown inline so the dialog stays open for a retry.
 */
export function ReasonDialog({
  open,
  onClose,
  title,
  description,
  confirmLabel,
  danger,
  reasonRequired = true,
  minLength = 3,
  children,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  confirmLabel: string;
  danger?: boolean;
  reasonRequired?: boolean;
  minLength?: number;
  children?: ReactNode;
  onConfirm: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setReason('');
      setError(null);
    }
  }, [open]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const text = reason.trim();
    if (reasonRequired && text.length < minLength) return setError(`Give a reason (at least ${minLength} characters)`);
    setBusy(true);
    try {
      await onConfirm(text);
      onClose();
    } catch (err) {
      const r = apiFieldErrors(err);
      setError(r.fields.reason ?? r.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      footer={
        <>
          <Button onClick={onClose}>Back</Button>
          <Button variant={danger ? 'danger' : 'primary'} type="submit" form="reason-form" loading={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <form id="reason-form" onSubmit={submit} noValidate className="space-y-4">
        {children}
        <Field label={reasonRequired ? 'Reason' : 'Note (optional)'} required={reasonRequired} error={error ?? undefined}>
          {(p) => <Textarea {...p} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={255} />}
        </Field>
      </form>
    </Dialog>
  );
}
