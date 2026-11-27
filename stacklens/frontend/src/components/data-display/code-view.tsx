'use client';
import { useMemo } from 'react';
import { formatSignatureTokens, formatTypeTokens, tokenizeType, type SignatureParts, type TypeToken } from '@stacklens/shared/type-format';
import { cn } from '@/lib/utils';

/**
 * Colours for inferred types and signatures, in the same family as the JSON and SQL views
 * (keywords violet, primitives sky, strings emerald) plus editor-style function/parameter colours.
 */
const TOKEN_CLASS: Record<TypeToken['type'], string> = {
  keyword: 'text-violet-600 dark:text-violet-400',
  primitive: 'text-sky-600 dark:text-sky-400',
  type: 'text-teal-700 dark:text-teal-300',
  key: 'text-foreground',
  param: 'text-orange-600 dark:text-orange-300',
  fn: 'text-amber-700 dark:text-amber-300 font-semibold',
  string: 'text-emerald-600 dark:text-emerald-400',
  number: 'text-sky-600 dark:text-sky-400',
  punct: 'text-muted-foreground',
  op: 'text-muted-foreground',
  ws: '',
};

export function TypeTokens({ tokens }: { tokens: TypeToken[] }) {
  return (
    <>
      {tokens.map((t, i) =>
        t.type === 'ws' ? (
          t.text
        ) : (
          <span key={i} className={TOKEN_CLASS[t.type]}>
            {t.text}
          </span>
        ),
      )}
    </>
  );
}

const BOX = 'block overflow-auto whitespace-pre rounded-md bg-muted/40 px-2.5 py-1.5 font-mono text-[11.5px] leading-[1.6]';

/** An inferred type, formatted (long object types expand one member per line) and highlighted. */
export function TypeView({ type, className, width = 56 }: { type: string; className?: string; width?: number }) {
  const tokens = useMemo(() => formatTypeTokens(type, width), [type, width]);
  return (
    <code className={cn(BOX, className)}>
      <TypeTokens tokens={tokens} />
    </code>
  );
}

/** A function signature, with parameters on their own lines when it doesn't fit. */
export function SignatureView({ sig, className, width = 64 }: { sig: SignatureParts; className?: string; width?: number }) {
  const tokens = useMemo(() => formatSignatureTokens(sig, width), [sig, width]);
  return (
    <code className={cn(BOX, className)}>
      <TypeTokens tokens={tokens} />
    </code>
  );
}

/** One-line highlighted type for tight spots (tables); pair with a tooltip showing TypeView. */
export function InlineType({ type, className }: { type: string; className?: string }) {
  const tokens = useMemo(() => {
    const raw = tokenizeType(type);
    const out: TypeToken[] = [];
    raw.forEach((t, i) => {
      const prev = raw[i - 1];
      if (
        prev &&
        !(t.type === 'punct' && /[,;)\]>.?:[(<]/.test(t.text) && t.text !== '{') &&
        !(prev.type === 'punct' && /[([<.]/.test(prev.text))
      )
        out.push({ type: 'ws', text: ' ' });
      out.push(t);
    });
    return out;
  }, [type]);
  return (
    <code className={cn('font-mono', className)}>
      <TypeTokens tokens={tokens} />
    </code>
  );
}

/** Copyable plain-text version of a signature (formatted the same way). */
export function signatureText(sig: SignatureParts, width = 64): string {
  return formatSignatureTokens(sig, width)
    .map((t) => t.text)
    .join('');
}
