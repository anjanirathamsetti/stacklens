import { cn } from '@/lib/utils';

export interface PrintColumn<T> {
  header: React.ReactNode;
  cell: (row: T, index: number) => React.ReactNode;
  className?: string;
  /** e.g. '18%' – the table uses a fixed layout so long values wrap instead of widening it */
  width?: string;
  align?: 'right';
}

/**
 * Table for PDF exports: fixed layout, header row repeated on every page (`thead` is a
 * table-header-group), rows never split across a page break, long values wrap.
 */
export function PrintTable<T>({
  columns,
  rows,
  rowKey,
  empty = 'No rows.',
  className,
}: {
  columns: PrintColumn<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string;
  empty?: React.ReactNode;
  className?: string;
}) {
  return (
    <table className={cn('print-table w-full table-fixed border-collapse text-[11px]', className)}>
      <colgroup>
        {columns.map((c, i) => (
          <col key={i} style={c.width ? { width: c.width } : undefined} />
        ))}
      </colgroup>
      <thead>
        <tr className="border-y bg-muted/60 text-left text-[10px] uppercase tracking-wide text-muted-foreground">
          {columns.map((c, i) => (
            <th key={i} className={cn('px-2 py-1.5 font-medium', c.align === 'right' && 'text-right', c.className)}>
              {c.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td colSpan={columns.length} className="px-2 py-4 text-center text-muted-foreground">
              {empty}
            </td>
          </tr>
        ) : (
          rows.map((r, ri) => (
            <tr key={rowKey(r, ri)} className="border-b align-top">
              {columns.map((c, i) => (
                <td key={i} className={cn('px-2 py-1.5', c.align === 'right' && 'text-right tabular-nums', c.className)}>
                  {c.cell(r, ri)}
                </td>
              ))}
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}
