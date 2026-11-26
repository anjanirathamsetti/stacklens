'use client';
import { ThemeProvider } from 'next-themes';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/toast';
import { SettingsProvider } from '@/lib/settings-context';
import { CurrentUserProvider } from '@/lib/current-user';
import type { AuthUser } from '@/lib/api-types';

export { useLive } from '@/lib/settings-context';

/** Providers for every page (theme, tooltips, toasts). */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <TooltipProvider>
        {children}
        <Toaster />
      </TooltipProvider>
    </ThemeProvider>
  );
}

/** Providers for signed-in pages: the current user and their personal settings. */
export function SignedInProviders({ user, children }: { user: AuthUser; children: React.ReactNode }) {
  return (
    <CurrentUserProvider user={user}>
      <SettingsProvider>{children}</SettingsProvider>
    </CurrentUserProvider>
  );
}
