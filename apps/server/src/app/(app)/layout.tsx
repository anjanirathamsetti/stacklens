import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { AppSidebar } from '@/components/layout/app-sidebar';
import { CommandPalette } from '@/components/layout/command-palette';
import { SignedInProviders } from '@/components/layout/providers';
import { getCurrentUser } from '@/server/auth/session';
import { countUsers } from '@/server/repositories/account-repository';

export const dynamic = 'force-dynamic';

/** Every page in this group needs a signed-in user (the proxy already sent cookie-less visitors to /login). */
export default async function SignedInLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect((await countUsers()) === 0 ? '/welcome' : '/login');
  if (user.mustChangePassword) redirect('/change-password');
  return (
    <SignedInProviders user={user}>
      <div className="flex h-dvh overflow-hidden bg-shell">
        <AppSidebar />
        {/* content sits on a raised card, separated from the sidebar by the shell background */}
        <main className="my-2 mr-2 flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border bg-background shadow-panel max-md:m-0 max-md:rounded-none max-md:border-0">
          {children}
        </main>
        <Suspense>
          <CommandPalette />
        </Suspense>
      </div>
    </SignedInProviders>
  );
}
