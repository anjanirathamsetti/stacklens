import 'server-only';
import { randomUUID } from 'node:crypto';
import type { SavedView } from '@stacklens/shared/api-types';
import { getDb } from '../db/client';

/** Named filter presets, shared by everyone using this StackLens server. */

interface ViewRow {
  id: string;
  name: string;
  path: string;
  query: string;
  description: string | null;
  pinned: boolean;
  created_by: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

const toView = (r: ViewRow): SavedView => ({
  id: r.id,
  name: r.name,
  path: r.path,
  query: r.query,
  description: r.description ?? undefined,
  pinned: r.pinned,
  createdBy: r.created_by ?? undefined,
  createdAt: new Date(r.created_at).getTime(),
  updatedAt: new Date(r.updated_at).getTime(),
});

export const VIEW_PATHS = ['/overview', '/traces', '/errors', '/incidents', '/hotspots', '/slos', '/digest'];

export type ViewInput = Pick<SavedView, 'name' | 'path' | 'query'> & Partial<Pick<SavedView, 'description' | 'pinned' | 'createdBy'>>;

/** Returns an error message, or undefined when the input is valid. */
export function validateView(v: Partial<ViewInput>, partial = false): string | undefined {
  if (!partial || v.name !== undefined)
    if (typeof v.name !== 'string' || !v.name.trim() || v.name.length > 80) return 'name is required (max 80 chars)';
  if (!partial || v.path !== undefined)
    if (typeof v.path !== 'string' || !VIEW_PATHS.includes(v.path)) return 'path must be a StackLens page';
  if (v.query !== undefined && (typeof v.query !== 'string' || v.query.length > 2000)) return 'query too long';
  if (v.description !== undefined && v.description !== null && (typeof v.description !== 'string' || v.description.length > 280))
    return 'description too long';
  return undefined;
}

/** Strip paging / selection so a view always opens on page 1. */
export function cleanQuery(q: string): string {
  const p = new URLSearchParams(q.replace(/^\?/, ''));
  for (const k of ['page', 'selected', 'trace', 'view']) p.delete(k);
  return p.toString();
}

export async function listViews(): Promise<SavedView[]> {
  const db = await getDb();
  return (await db.query<ViewRow>('select * from saved_views order by pinned desc, lower(name)')).map(toView);
}

export async function createView(v: ViewInput): Promise<SavedView> {
  const db = await getDb();
  const [r] = await db.query<ViewRow>(
    `insert into saved_views (id, name, path, query, description, pinned, created_by)
     values ($1, $2, $3, $4, $5, $6, $7) returning *`,
    [randomUUID(), v.name.trim(), v.path, cleanQuery(v.query ?? ''), v.description?.trim() || null, !!v.pinned, v.createdBy || null],
  );
  return toView(r);
}

export async function updateView(id: string, v: Partial<ViewInput>): Promise<SavedView | undefined> {
  const db = await getDb();
  const [r] = await db.query<ViewRow>(
    `update saved_views set
       name = coalesce($2, name), path = coalesce($3, path), query = coalesce($4, query),
       description = case when $5::boolean then $6 else description end,
       pinned = coalesce($7, pinned), updated_at = now()
     where id = $1 returning *`,
    [
      id,
      v.name?.trim() ?? null,
      v.path ?? null,
      v.query === undefined ? null : cleanQuery(v.query),
      v.description !== undefined,
      v.description?.trim() || null,
      v.pinned ?? null,
    ],
  );
  return r ? toView(r) : undefined;
}

export async function deleteView(id: string): Promise<boolean> {
  const db = await getDb();
  return (await db.query('delete from saved_views where id = $1 returning id', [id])).length > 0;
}
