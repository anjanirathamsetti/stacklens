import { notFound } from 'next/navigation';
import { getCurrentUser, hasRole } from '@/server/session';

export const dynamic = 'force-dynamic';

/** Admin exports need the admin role, like the admin pages (the APIs behind them check it again). */
export default async function PrintAdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user || !hasRole(user, 'admin')) notFound();
  return children;
}
