import { redirect } from 'next/navigation';
import { AdminMobileNav, AdminNav } from '@/features/admin/admin-nav';
import { getCurrentUser, hasRole } from '@/server/session';

export const dynamic = 'force-dynamic';

/** Admin-only section with its own menu. The API routes behind it check the role again. */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user || !hasRole(user, 'admin')) redirect('/overview');
  return (
    <div className="flex min-h-0 flex-1">
      <AdminNav />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <AdminMobileNav />
        {children}
      </div>
    </div>
  );
}
