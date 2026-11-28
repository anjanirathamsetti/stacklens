'use client';
import { FileDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import { MAX_PRINT_ROWS, UI_ONLY_KEYS } from '@/components/print/print-query';

/**
 * Opens the print layout of a page (`/print/<report>`) in a new tab with the current URL filters,
 * plus `params` for state that only lives in the page (search box, tab, sort). The print tab opens
 * the browser's print dialog, where "Save as PDF" writes the file.
 *
 * Both variants are icon buttons with a tooltip. `variant="table"` is the one in a table's toolbar: it exports the whole filtered
 * table (up to MAX_PRINT_ROWS rows) instead of the page as shown.
 */
export function ExportPdfButton({
  report,
  params = {},
  variant = 'page',
  noun = 'rows',
  disabled,
}: {
  /** path under /print, e.g. `traces` or `traces/<id>` */
  report: string;
  params?: Record<string, string | number | boolean | null | undefined>;
  variant?: 'page' | 'table';
  /** what the table lists, for the tooltip ("traces") */
  noun?: string;
  disabled?: boolean;
}) {
  const open = () => {
    const p = new URLSearchParams(window.location.search);
    for (const k of UI_ONLY_KEYS) p.delete(k);
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null || v === '' || v === false) p.delete(k);
      else p.set(k, String(v));
    }
    if (!p.has('at')) p.set('at', String(Date.now()));
    if (variant === 'table') p.set('scope', 'all');
    p.set('print', '1');
    window.open(`/print/${report}?${p}`, '_blank');
  };

  if (variant === 'table')
    return (
      <Tooltip content={`Export this table as PDF (all matching ${noun}, up to ${MAX_PRINT_ROWS})`}>
        <Button variant="outline" size="icon" onClick={open} disabled={disabled} aria-label={`Export ${noun} table as PDF`}>
          <FileDown />
        </Button>
      </Tooltip>
    );
  return (
    <Tooltip content="Export PDF: opens a print layout of this page to save from the print dialog">
      <Button variant="outline" size="icon" onClick={open} disabled={disabled} aria-label="Export PDF">
        <FileDown />
      </Button>
    </Tooltip>
  );
}
