'use client';
import { ThemeProvider } from 'next-themes';
import { TooltipProvider } from '@/components/ui/tooltip';
import { SettingsProvider } from '@/lib/settings-context';

export { useLive } from '@/lib/settings-context';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <SettingsProvider>
        <TooltipProvider>{children}</TooltipProvider>
      </SettingsProvider>
    </ThemeProvider>
  );
}
