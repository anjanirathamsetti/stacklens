'use client';
import { useMemo, useState } from 'react';
import { Database } from 'lucide-react';
import { formatSqlTokens, tokenizeSql, type SqlToken } from '@stacklens/shared/sql-format';
import { cn } from '@/lib/utils';
import { CopyButton } from '@/components/data-display/json-view';

/** Token colours, matched to the JSON viewer (strings emerald, numbers sky, booleans/keywords violet). */
const TOKEN_CLASS: Record<SqlToken['type'], string> = {
  keyword: 'text-violet-600 dark:text-violet-400 font-medium',
  string: 'text-emerald-600 dark:text-emerald-400',
  number: 'text-sky-600 dark:text-sky-400',
  param: 'text-amber-600 dark:text-amber-400',
  ident: 'text-foreground',
  word: 'text-foreground',
  comment: 'text-muted-foreground italic',
  op: 'text-muted-foreground',
  punct: 'text-muted-foreground',
  ws: '',
};

function Highlighted({ tokens }: { tokens: SqlToken[] }) {
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

/**
 * A SQL statement, formatted and highlighted by default (like JSON values), with line numbers,
 * a Pretty / Raw toggle and copy.
 */
export function SqlView({ sql, className, maxHeight = 360 }: { sql: string; className?: string; maxHeight?: number }) {
  const [raw, setRaw] = useState(false);
  const pretty = useMemo(() => formatSqlTokens(sql), [sql]);
  const tokens = useMemo(() => (raw ? tokenizeSql(sql) : pretty), [raw, sql, pretty]);
  const text = useMemo(() => pretty.map((t) => t.text).join(''), [pretty]);
  const lines = raw ? 1 : text.split('\n').length;

  return (
    <div className={cn('overflow-hidden rounded-md border bg-muted/30', className)}>
      <div className="flex items-center justify-between gap-2 border-b bg-muted/40 px-2 py-1">
        <span className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          <Database className="size-3" /> SQL
        </span>
        <span className="flex items-center gap-1">
          <span className="flex rounded-md border bg-background p-0.5 text-[10px]">
            {(['Pretty', 'Raw'] as const).map((l) => (
              <button
                key={l}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setRaw(l === 'Raw');
                }}
                className={cn(
                  'rounded px-1.5 py-px font-medium transition-colors cursor-pointer',
                  (l === 'Raw') === raw ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {l}
              </button>
            ))}
          </span>
          <CopyButton text={raw ? sql : text} />
        </span>
      </div>
      <div className="flex overflow-auto font-mono text-[11.5px] leading-[1.6]" style={{ maxHeight }}>
        {!raw && (
          <div aria-hidden className="select-none border-r px-2 py-2 text-right text-muted-foreground/50 tabular-nums">
            {Array.from({ length: lines }, (_, i) => (
              <div key={i}>{i + 1}</div>
            ))}
          </div>
        )}
        <pre className={cn('min-w-0 flex-1 px-3 py-2', raw ? 'whitespace-pre-wrap break-all' : 'whitespace-pre')}>
          <Highlighted tokens={tokens} />
        </pre>
      </div>
    </div>
  );
}

/** SQL found inside a JSON value: shown formatted by default, collapsible to a one-line preview. */
export function InlineSql({ sql }: { sql: string }) {
  const [open, setOpen] = useState(true);
  const preview = sql.replace(/\s+/g, ' ').trim();
  return (
    <span className="inline-block max-w-full align-top">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(!open);
        }}
        className="inline-flex max-w-full items-center gap-1.5 rounded px-0.5 text-left hover:bg-accent cursor-pointer"
        title={open ? 'Collapse' : 'Show formatted SQL'}
      >
        <span className="shrink-0 rounded bg-violet-500/12 px-1 text-[9.5px] font-semibold text-violet-600 dark:text-violet-400">SQL</span>
        {!open && <span className="truncate text-emerald-600 dark:text-emerald-400">{preview}</span>}
      </button>
      {open && <SqlView sql={sql} className="mt-1" maxHeight={280} />}
    </span>
  );
}
