'use client';
import { toPlain } from '@/components/data-display/json-view';
import { cn } from '@/lib/utils';

/** Longest serialized value printed in full; the rest is cut with a note (open the trace for all of it). */
export const MAX_VALUE_CHARS = 1500;

/** `{ "a": 1, "b": [1, 2] }` – JSON on one wrapping line, for values too big to pretty-print on paper. */
function compactJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(compactJson).join(', ')}]`;
  if (v && typeof v === 'object') {
    const parts = Object.entries(v)
      .filter(([, x]) => x !== undefined)
      .map(([k, x]) => `${JSON.stringify(k)}: ${compactJson(x)}`);
    return parts.length ? `{ ${parts.join(', ')} }` : '{}';
  }
  return JSON.stringify(v) ?? String(v);
}

/** Pretty JSON when it stays short (≤ 12 lines), compact JSON otherwise. */
export function valueText(v: unknown): string {
  if (typeof v === 'string') return v;
  const plain = toPlain(v);
  if (plain === undefined) return 'undefined';
  try {
    const pretty = JSON.stringify(plain, null, 2) ?? String(plain);
    return pretty.split('\n').length <= 12 ? pretty : compactJson(plain);
  } catch {
    return String(plain);
  }
}

/** Captured value (args, result, body…) as wrapped monospace text, cut at `max` characters. */
export function PrintValue({ value, max = MAX_VALUE_CHARS, className }: { value: unknown; max?: number; className?: string }) {
  const text = valueText(value);
  const cut = text.length > max;
  return (
    <pre
      className={cn(
        'whitespace-pre-wrap break-all rounded border bg-muted/40 px-1.5 py-1 font-mono text-[9.5px] leading-snug text-foreground/90',
        className,
      )}
    >
      {cut ? text.slice(0, max) : text}
      {cut && <span className="text-muted-foreground">{`\n… ${(text.length - max).toLocaleString()} more characters not shown`}</span>}
    </pre>
  );
}
