import { forwardRef, type ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'ai';
type Size = 'sm' | 'md';

const variants: Record<Variant, string> = {
  primary: 'bg-primary text-white hover:bg-primary-strong border border-transparent',
  secondary: 'bg-surface text-ink border border-line hover:border-line-strong hover:bg-canvas',
  danger: 'bg-crit text-white hover:bg-[#dc2626] border border-transparent',
  ghost: 'bg-transparent text-ink hover:bg-subtle border border-transparent',
  ai: 'bg-ai text-white hover:bg-[#7c3aed] border border-transparent',
};
const sizes: Record<Size, string> = {
  sm: 'h-8 px-2.5 text-[13px] gap-1.5',
  md: 'h-9 px-3.5 text-sm gap-2',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading, disabled, className = '', children, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`inline-flex shrink-0 items-center justify-center rounded font-medium transition-colors active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60 ${variants[variant]} ${sizes[size]} ${className}`}
      {...rest}
    >
      {loading && (
        <span className="size-3.5 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden />
      )}
      {children}
    </button>
  );
});
