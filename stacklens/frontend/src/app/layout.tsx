import type { Metadata } from 'next';
import { Geist, Geist_Mono, Outfit } from 'next/font/google';
import { Providers } from '@/components/layout/providers';
import '@/app/globals.css';

const sans = Geist({ subsets: ['latin'], variable: '--font-geist-sans' });
const mono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono' });
/** Wordmark only (see components/brand/logo.tsx). */
const brand = Outfit({ subsets: ['latin'], weight: '500', variable: '--font-outfit' });

export const metadata: Metadata = {
  title: { default: 'StackLens', template: '%s · StackLens' },
  description: 'Call-tree tracing for Node.js backends – NestJS, Express and TypeORM',
};

/** Shell shared by every page. Signed-in pages add the sidebar in `(app)/layout.tsx`; sign-in pages live in `(auth)`. */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${sans.variable} ${mono.variable} ${brand.variable} font-sans`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
