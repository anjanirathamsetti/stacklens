import { redirect } from 'next/navigation';
import { SignedInProviders } from '@/components/layout/providers';
import { getCurrentUser } from '@/server/session';
import { countUsers } from '@stacklens/backend/repositories/account-repository';

export const dynamic = 'force-dynamic';

/**
 * Print layouts behind the "Export PDF" buttons (`/print/*`): the same sign-in checks as the
 * app, no sidebar, always the light theme (see Providers). Each report loads its data from the
 * same API routes as the page it exports, so role checks apply unchanged.
 */
export default async function PrintLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect((await countUsers()) === 0 ? '/welcome' : '/login');
  if (user.mustChangePassword) redirect('/change-password');
  return <SignedInProviders user={user}>{children}</SignedInProviders>;
}
