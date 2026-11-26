'use client';
import { useEffect, useState } from 'react';
import { CheckCircle2, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Minimal toasts: `toast('Link copied')` from anywhere; <Toaster /> renders them. */

interface Toast {
  id: number;
  message: string;
  tone: 'success' | 'error';
}

let nextId = 1;
let push: ((t: Toast) => void) | undefined;

export function toast(message: string, tone: Toast['tone'] = 'success') {
  push?.({ id: nextId++, message, tone });
}

export function Toaster() {
  const [items, setItems] = useState<Toast[]>([]);
  useEffect(() => {
    push = (t) => {
      setItems((xs) => [...xs.slice(-2), t]);
      setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== t.id)), 2600);
    };
    return () => {
      push = undefined;
    };
  }, []);
  return (
    <div
      className="pointer-events-none fixed bottom-4 left-1/2 z-[100] flex -translate-x-1/2 flex-col items-center gap-2"
      aria-live="polite"
    >
      {items.map((t) => (
        <div
          key={t.id}
          className="flex items-center gap-2 rounded-lg border bg-popover px-3 py-2 text-sm shadow-lg"
          style={{ animation: 'menu-in 140ms ease-out' }}
        >
          {t.tone === 'success' ? (
            <CheckCircle2 className="size-4 text-success" />
          ) : (
            <AlertTriangle className={cn('size-4 text-destructive')} />
          )}
          {t.message}
        </div>
      ))}
    </div>
  );
}

/** Copy text and confirm with a toast. */
export async function copyWithToast(text: string, message = 'Copied to clipboard') {
  try {
    await navigator.clipboard.writeText(text);
    toast(message);
  } catch {
    toast('Could not copy – your browser blocked clipboard access', 'error');
  }
}
