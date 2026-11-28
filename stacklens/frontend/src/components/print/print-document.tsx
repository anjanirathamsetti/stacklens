'use client';
import { useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { AlertTriangle, Info, Loader2, Printer, X } from 'lucide-react';
import { LogoMark, Wordmark } from '@/components/brand/logo';
import { Button } from '@/components/ui/button';
import { printDateTime, type PrintFilter } from '@/components/print/print-query';
import { cn } from '@/lib/utils';

/** A string that is safe inside a CSS `content: "…"` declaration. */
function cssString(s: string): string {
  const safe = [...s].map((c) => (c < ' ' || c === '<' || c === '>' ? ' ' : c === '\\' || c === '"' ? `\\${c}` : c)).join('');
  return `"${safe}"`;
}

/** "2026-11-27 1405" for the suggested file name. */
function fileStamp(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}${p(d.getMinutes())}`;
}

/**
 * Shell of every PDF export: StackLens header, title, applied filters, notes about limits and a
 * footer with the page number (CSS `@page` margin boxes). Always light (the print layout forces
 * the light theme), A4 portrait. On screen it shows as a paper preview with a "Save as PDF" bar;
 * with `?print=1` (set by the Export PDF buttons) the print dialog opens once the data is in.
 */
export function PrintDocument({
  title,
  subtitle,
  filters = [],
  notes = [],
  generatedAt,
  ready,
  error,
  landscape,
  children,
}: {
  title: string;
  subtitle?: React.ReactNode;
  filters?: PrintFilter[];
  /** limits and caveats, e.g. "First 500 of 1,204 traces" */
  notes?: string[];
  generatedAt?: number;
  ready: boolean;
  error?: string;
  /** A4 landscape, for wide tables */
  landscape?: boolean;
  children?: React.ReactNode;
}) {
  const sp = useSearchParams();
  const autoPrint = sp.get('print') === '1';
  const printed = useRef(false);

  useEffect(() => {
    document.title = `StackLens – ${title}${generatedAt ? ` – ${fileStamp(generatedAt)}` : ''}`;
  }, [title, generatedAt]);

  useEffect(() => {
    if (!ready) return;
    // tests and the headless PDF check wait for this flag
    document.documentElement.dataset.printReady = '1';
    if (!autoPrint || printed.current) return;
    let cancelled = false;
    void document.fonts.ready.then(() =>
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (cancelled || printed.current) return;
          printed.current = true;
          // a reload of this tab shouldn't open the dialog again
          const url = new URL(window.location.href);
          url.searchParams.delete('print');
          window.history.replaceState(null, '', url);
          window.print();
        }),
      ),
    );
    return () => {
      cancelled = true;
    };
  }, [ready, autoPrint]);

  const footer = `StackLens · ${title}${generatedAt ? ` · generated ${printDateTime(generatedAt)}` : ''}`;

  return (
    <div className="min-h-dvh bg-shell print:min-h-0 print:bg-white">
      <style>{`@page { ${landscape ? 'size: A4 landscape; ' : ''}@bottom-left { content: ${cssString(footer)}; } }`}</style>

      {/* screen only: what to do with this tab */}
      <div className="sticky top-0 z-10 border-b bg-background/90 backdrop-blur print:hidden">
        <div className={cn('mx-auto flex h-12 items-center gap-3 px-1', landscape ? 'max-w-[297mm]' : 'max-w-[210mm]')}>
          <span className="text-xs text-muted-foreground">
            Print preview · choose <span className="font-medium text-foreground">Save as PDF</span> as the destination
          </span>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => window.close()}>
              <X /> Close
            </Button>
            <Button size="sm" onClick={() => window.print()} disabled={!ready}>
              <Printer /> Save as PDF
            </Button>
          </div>
        </div>
      </div>

      <article
        className={cn(
          'print-sheet mx-auto my-6 max-w-full rounded-lg border bg-white px-[12mm] py-[11mm] text-foreground shadow-panel print:m-0 print:w-auto print:rounded-none print:border-0 print:p-0 print:shadow-none',
          landscape ? 'w-[297mm]' : 'w-[210mm]',
        )}
      >
        {/*
          The report sits in a one-cell table whose <thead> is the StackLens bar: browsers repeat a
          table's header group at the top of every printed page, so the brand bar shows on each
          page while the title, filters and notes below appear once.
        */}
        <table className="print-frame w-full border-collapse">
          <thead>
            <tr>
              <td className="p-0 pb-4">
                <div className="flex items-center justify-between gap-4 border-b-2 border-brand pb-2.5">
                  <span className="inline-flex items-center gap-2 text-foreground">
                    <LogoMark className="size-6" />
                    <Wordmark className="text-[17px]" />
                  </span>
                  <div className="text-right text-[10px] leading-tight text-muted-foreground">
                    <div className="font-medium uppercase tracking-wider">{title}</div>
                    <div className="font-mono">{generatedAt ? `Generated ${printDateTime(generatedAt, true)}` : 'Loading…'}</div>
                  </div>
                </div>
              </td>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="p-0 align-top">
                <header className="mb-5 break-inside-avoid">
                  <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
                  {subtitle && <div className="mt-0.5 text-xs text-muted-foreground">{subtitle}</div>}
                  {filters.length > 0 && (
                    <dl className="mt-3 flex flex-wrap gap-1.5 text-[10.5px]">
                      {filters.map((f) => (
                        <div
                          key={f.label}
                          className="inline-flex max-w-full items-baseline gap-1.5 rounded-md border bg-muted/50 px-2 py-0.5"
                        >
                          <dt className="text-muted-foreground">{f.label}</dt>
                          <dd className="min-w-0 break-words font-mono font-medium">{f.value}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  {notes.length > 0 && (
                    <ul className="mt-2 space-y-0.5 text-[10.5px] text-muted-foreground">
                      {notes.map((n) => (
                        <li key={n} className="flex items-start gap-1.5">
                          <Info className="mt-px size-3 shrink-0" />
                          {n}
                        </li>
                      ))}
                    </ul>
                  )}
                </header>

                {error ? (
                  <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                    <AlertTriangle className="size-4" /> Couldn’t load this report: {error}
                  </div>
                ) : !ready ? (
                  <div className="grid h-48 place-items-center text-muted-foreground">
                    <Loader2 className="size-5 animate-spin" />
                  </div>
                ) : (
                  <div className="space-y-6">{children}</div>
                )}
              </td>
            </tr>
          </tbody>
        </table>
      </article>
    </div>
  );
}

/** A titled block of the report. Small sections stay on one page; tables may flow across pages. */
export function PrintSection({
  title,
  description,
  right,
  keepTogether,
  className,
  children,
}: {
  title: string;
  description?: React.ReactNode;
  right?: React.ReactNode;
  /** avoid splitting this section over two pages (cards, charts) */
  keepTogether?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={cn(keepTogether && 'break-inside-avoid', className)}>
      <div className="mb-2 flex items-end justify-between gap-3 break-after-avoid">
        <div>
          <h2 className="text-[13px] font-semibold">{title}</h2>
          {description && <p className="text-[10.5px] text-muted-foreground">{description}</p>}
        </div>
        {right && <div className="shrink-0 text-[10.5px] text-muted-foreground">{right}</div>}
      </div>
      {children}
    </section>
  );
}

/** KPI tile. */
export function PrintStat({
  label,
  value,
  unit,
  sub,
  tone,
  children,
}: {
  label: string;
  value: React.ReactNode;
  unit?: string;
  sub?: React.ReactNode;
  tone?: 'error' | 'warning' | 'success';
  children?: React.ReactNode;
}) {
  return (
    <div className="break-inside-avoid rounded-lg border px-3 py-2.5">
      <div className="text-[10.5px] font-medium text-muted-foreground">{label}</div>
      <div className="mt-0.5 flex items-baseline gap-1">
        <span
          className={cn(
            'font-mono text-lg font-semibold tabular-nums',
            tone === 'error' && 'text-destructive',
            tone === 'warning' && 'text-warning',
            tone === 'success' && 'text-success',
          )}
        >
          {value}
        </span>
        {unit && <span className="text-[11px] text-muted-foreground">{unit}</span>}
      </div>
      {sub && <div className="mt-0.5 text-[10px] text-muted-foreground">{sub}</div>}
      {children}
    </div>
  );
}

/** Empty-state line inside a section. */
export function PrintEmpty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-md border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">{children}</div>;
}
