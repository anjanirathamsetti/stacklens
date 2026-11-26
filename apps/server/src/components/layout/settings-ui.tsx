'use client';
import { useState } from 'react';
import { Check } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/** Building blocks shared by the Settings and Admin pages. */

export function Section({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <Card className="overflow-hidden">
      <div className="border-b px-5 py-4">
        <div className="text-sm font-semibold">{title}</div>
        {description && <div className="mt-0.5 text-xs text-muted-foreground">{description}</div>}
      </div>
      <div className="space-y-4 px-5 py-4">{children}</div>
      {footer && <div className="flex items-center justify-end gap-2 border-t bg-muted/30 px-5 py-3">{footer}</div>}
    </Card>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5 sm:grid-cols-[200px_1fr] sm:items-center sm:gap-6">
      <div>
        <div className="text-sm font-medium">{label}</div>
        {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
      </div>
      <div>{children}</div>
    </div>
  );
}

export function useSaved() {
  const [saved, setSaved] = useState(false);
  const flash = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 1600);
  };
  return [saved, flash] as const;
}

export function SavedNote({ show }: { show: boolean }) {
  return (
    <span className={cn('mr-auto flex items-center gap-1 text-xs text-success transition-opacity', show ? 'opacity-100' : 'opacity-0')}>
      <Check className="size-3.5" /> Saved
    </span>
  );
}
