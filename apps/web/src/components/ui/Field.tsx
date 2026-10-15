import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';

const control =
  'rounded border bg-surface px-3 text-sm text-ink placeholder:text-muted/70 focus:outline-none focus:ring-2 disabled:bg-subtle disabled:text-muted';
const ok = 'border-line-strong focus:border-primary focus:ring-primary/15';
const bad = 'border-crit focus:border-crit focus:ring-crit/15';
/** Full width unless the caller passes its own width utility (e.g. `w-auto`, `w-48`). */
const width = (className: string) => (/(^|\s)(min-|max-)?w-/.test(className) ? '' : 'w-full');

/** Props a Field hands to its control; spread them straight onto Input/Select/Textarea. */
export interface ControlProps {
  id: string;
  invalid: boolean;
  'aria-describedby'?: string;
}

interface FieldProps {
  label: string;
  error?: string;
  hint?: string;
  required?: boolean;
  className?: string;
  children: (props: ControlProps) => ReactNode;
}

/** Label + control + hint/error with correct aria wiring. */
export function Field({ label, error, hint, required, className = '', children }: FieldProps) {
  const id = useId();
  const msgId = `${id}-msg`;
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-[13px] font-medium text-ink">
        {label}
        {required && <span className="ml-0.5 text-crit" aria-hidden>*</span>}
      </label>
      {children({ id, invalid: !!error, 'aria-describedby': error || hint ? msgId : undefined })}
      {error ? (
        <p id={msgId} className="mt-1 text-xs text-crit-strong">{error}</p>
      ) : hint ? (
        <p id={msgId} className="mt-1 text-xs text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

type InputProps = InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean; mono?: boolean };
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ invalid, mono, className = '', ...rest }, ref) {
  return (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={`${control} ${width(className)} h-9 ${invalid ? bad : ok} ${mono ? 'font-mono tracking-wide uppercase' : ''} ${className}`}
      {...rest}
    />
  );
});

type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean };
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select({ invalid, className = '', children, ...rest }, ref) {
  return (
    <select ref={ref} aria-invalid={invalid || undefined} className={`${control} ${width(className)} h-9 pr-8 ${invalid ? bad : ok} ${className}`} {...rest}>
      {children}
    </select>
  );
});

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean };
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea({ invalid, className = '', ...rest }, ref) {
  return <textarea ref={ref} aria-invalid={invalid || undefined} className={`${control} ${width(className)} min-h-20 py-2 ${invalid ? bad : ok} ${className}`} {...rest} />;
});
