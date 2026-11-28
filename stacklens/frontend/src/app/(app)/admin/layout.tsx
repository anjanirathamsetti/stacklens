import { redirect } from 'next/navigation';
import { SettingsMobileNav, SettingsNav } from '@/features/settings/settings-nav';
import { getCurrentUser, hasRole } from '@/server/session';

export const dynamic = 'force-dynamic';

/** Team settings (admins only), shown with the shared Settings menu. The API routes behind it check the role again. */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user || !hasRole(user, 'admin')) redirect('/overview');
  return (
    <div className="flex min-h-0 flex-1">
      <SettingsNav />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <SettingsMobileNav />
        {children}
      </div>
    </div>
  );
}
