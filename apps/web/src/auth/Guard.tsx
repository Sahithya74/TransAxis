import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { ShieldOff } from 'lucide-react';
import type { Permission } from '@transaxis/shared';
import { useAuth } from './AuthProvider';

/**
 * Hides a page from users without the permission. This is a courtesy for the UI only; the API
 * rejects the same requests with 403 regardless of what the browser shows.
 */
export function Guard({ anyOf, children }: { anyOf: Permission[]; children: ReactNode }) {
  const { can } = useAuth();
  if (can(...anyOf)) return <>{children}</>;
  return (
    <div className="mx-auto flex max-w-md flex-col items-center pt-16 text-center">
      <ShieldOff className="mb-3 size-8 text-line-strong" aria-hidden />
      <h1 className="text-xl">You don’t have access to this page</h1>
      <p className="mt-2 text-[13px] text-muted">
        Your role doesn’t include this area. If you need it for your work, ask an administrator to update your role.
      </p>
      <Link to="/" className="mt-4 text-[13px] text-primary hover:underline">Go to dashboard</Link>
    </div>
  );
}
