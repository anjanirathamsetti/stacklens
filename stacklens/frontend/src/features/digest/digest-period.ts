/** Digest periods, shared by the Digest page and its PDF export. */
export const PERIODS = {
  '24h': 'Last 24 hours',
  yesterday: 'Yesterday',
  today: 'Today so far',
  '7d': 'Last 7 days',
} as const;
export type Period = keyof typeof PERIODS;

export function windowOf(p: Period, now: number): { from: number; to: number } {
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const m = midnight.getTime();
  if (p === 'yesterday') return { from: m - 86_400_000, to: m };
  if (p === 'today') return { from: m, to: now };
  if (p === '7d') return { from: now - 7 * 86_400_000, to: now };
  return { from: now - 86_400_000, to: now };
}
