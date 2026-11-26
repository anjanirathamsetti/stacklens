import type { SloState } from '@/lib/api-types';

export const pct = (n: number, digits?: number) => {
  const d = digits ?? (n >= 0.999 || n <= 0.001 ? 2 : 1);
  return `${(n * 100).toFixed(d).replace(/\.0+$/, '')}%`;
};

export const STATE_META: Record<SloState, { label: string; tone: 'success' | 'warning' | 'error' | 'neutral'; dot: string; text: string }> =
  {
    healthy: { label: 'Healthy', tone: 'success', dot: 'bg-success', text: 'text-success' },
    'at-risk': { label: 'At risk', tone: 'warning', dot: 'bg-warning', text: 'text-warning' },
    breached: { label: 'Breached', tone: 'error', dot: 'bg-destructive', text: 'text-destructive' },
    'no-data': { label: 'No traffic', tone: 'neutral', dot: 'bg-muted-foreground/40', text: 'text-muted-foreground' },
  };

export const TARGETS = [0.9, 0.95, 0.975, 0.99, 0.995, 0.999, 0.9995, 0.9999];
export const WINDOWS = [1, 7, 14, 28, 30];
