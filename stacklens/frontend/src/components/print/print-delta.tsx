import { cn } from '@/lib/utils';

/** "▲ 12% vs previous period", coloured by whether the change is good or bad. */
export function PrintDelta({
  cur,
  prev,
  higherIsBad,
  mode = 'pct',
}: {
  cur: number;
  prev: number;
  higherIsBad?: boolean;
  mode?: 'pct' | 'pp';
}) {
  if (!prev) return <span>no data in the previous period</span>;
  const diff = mode === 'pp' ? (cur - prev) * 100 : ((cur - prev) / prev) * 100;
  if (Math.abs(diff) < 0.5) return <span>no change vs previous period</span>;
  const up = diff > 0;
  const bad = higherIsBad ? up : !up;
  return (
    <span>
      <span className={cn('font-mono font-medium', bad ? 'text-destructive' : 'text-success')}>
        {up ? '▲' : '▼'} {Math.abs(diff).toFixed(Math.abs(diff) < 10 ? 1 : 0)}
        {mode === 'pp' ? ' pp' : '%'}
      </span>{' '}
      vs previous period
    </span>
  );
}
