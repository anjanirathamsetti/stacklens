import { Logo } from '@/components/brand/logo';

export const dynamic = 'force-dynamic';

/** Minimal shell for sign-in pages: no sidebar, centered card. */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-background px-4 py-10">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_50%_-10%,color-mix(in_oklch,var(--brand)_18%,transparent),transparent)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)] bg-[size:48px_48px] opacity-30 [mask-image:radial-gradient(ellipse_at_center,black_20%,transparent_70%)]"
      />
      <div className="relative w-full max-w-[400px]">
        <div className="mb-6 flex justify-center">
          <Logo markClassName="size-8" wordmarkClassName="text-2xl" />
        </div>
        {children}
        <p className="mt-6 text-center text-xs text-muted-foreground">Call-tree tracing for Node.js and Python backends</p>
      </div>
    </div>
  );
}
