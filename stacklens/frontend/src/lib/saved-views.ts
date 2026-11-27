'use client';
import type { SavedView } from '@stacklens/shared/api-types';
import { invalidate, sendJson, useResource } from '@/lib/use-resource';
import { parseRelative } from '@/lib/url-filters';

export const VIEWS_URL = '/api/views';

export function useSavedViews() {
  const { data, loading, reload } = useResource<{ views: SavedView[] }>(VIEWS_URL);
  return { views: data?.views ?? [], loading, reload };
}

export async function saveView(v: Pick<SavedView, 'name' | 'path' | 'query'> & Partial<SavedView>) {
  const r = await sendJson<{ view: SavedView }>(VIEWS_URL, 'POST', v);
  await invalidate(VIEWS_URL);
  return r.view;
}

export async function patchView(id: string, patch: Partial<SavedView>) {
  const r = await sendJson<{ view: SavedView }>(`${VIEWS_URL}/${id}`, 'PATCH', patch);
  await invalidate(VIEWS_URL);
  return r.view;
}

export async function removeView(id: string) {
  await sendJson(`${VIEWS_URL}/${id}`, 'DELETE');
  await invalidate(VIEWS_URL);
}

const IGNORED = ['page', 'selected', 'trace', 'view', 'size'];

/** Canonical form of a query string so equal filters compare equal regardless of key order. */
export function normalizeQuery(q: string): string {
  const p = new URLSearchParams(q.replace(/^\?/, ''));
  for (const k of IGNORED) p.delete(k);
  return [...p.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');
}

export const PAGE_LABELS: Record<string, string> = {
  '/overview': 'Overview',
  '/traces': 'Traces',
  '/errors': 'Errors',
  '/incidents': 'Incidents',
  '/hotspots': 'Hotspots',
  '/slos': 'SLOs',
  '/digest': 'Digest',
};

/** "billing-api · user 42 · 5xx · last 24 hours" */
export function describeQuery(q: string): string {
  const p = new URLSearchParams(q);
  const parts: string[] = [];
  if (p.get('project')) parts.push(p.get('project')!);
  if (p.get('app')) parts.push(p.get('app')!);
  if (p.get('env')) parts.push(p.get('env')!);
  if (p.get('user')) parts.push(`user ${p.get('user')}`);
  if (p.get('status')) parts.push(p.get('status')!);
  if (p.get('method')) parts.push(p.get('method')!);
  if (p.get('search')) parts.push(`“${p.get('search')}”`);
  if (p.get('kind')) parts.push(p.get('kind')!);
  const range = p.get('range');
  if (range === 'abs' && p.get('from') && p.get('to')) parts.push('fixed window');
  else if (range) parts.push(parseRelative(range)?.label.toLowerCase() ?? range);
  return parts.join(' · ') || 'No filters';
}
