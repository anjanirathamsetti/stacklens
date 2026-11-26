import 'server-only';
/**
 * Incident management – ServiceNow integration.
 *
 * Real mode (when SERVICENOW_INSTANCE + credentials are set, e.g. in apps/server/.env.local):
 *   uses the ServiceNow Table API (`/api/now/table/incident`). Every incident StackLens creates carries
 *   `correlation_id = stacklens:<errorGroupId>`, which is how tickets are tied back to error groups –
 *   including tickets someone later edits directly in ServiceNow.
 *
 * Demo mode (no credentials): incidents are kept in StackLens's own database (`incidents` table) so the
 * workflow can be tried end-to-end. Nothing is sent anywhere. The UI labels this mode clearly.
 */
import { env } from './env';
import { getLocalIncident, listLocalIncidents, nextIncidentNumber, saveLocalIncident } from './repositories/incident-repository';
import type { Incident, IncidentRef, IncidentSource, WorkNote } from '@/lib/api-types';

const PREFIX = 'stacklens:';

const STATES: Record<number, string> = { 1: 'New', 2: 'In Progress', 3: 'On Hold', 6: 'Resolved', 7: 'Closed', 8: 'Canceled' };
const PRIORITIES: Record<number, string> = { 1: '1 - Critical', 2: '2 - High', 3: '3 - Moderate', 4: '4 - Low', 5: '5 - Planning' };

/** ServiceNow's default urgency × impact → priority matrix */
export function priorityOf(urgency: number, impact: number) {
  const sum = urgency + impact;
  return sum <= 2 ? 1 : sum === 3 ? 2 : sum === 4 ? 3 : sum === 5 ? 4 : 5;
}

function config() {
  const { instance, username: user, password: pass, token } = env.serviceNow;
  const configured = !!instance && (!!token || (!!user && !!pass));
  const baseUrl = instance
    ? instance.startsWith('http')
      ? instance.replace(/\/$/, '')
      : `https://${instance}.service-now.com`
    : undefined;
  return {
    configured,
    baseUrl,
    auth: token ? `Bearer ${token}` : user && pass ? `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}` : undefined,
    assignmentGroup: env.serviceNow.assignmentGroup,
    callerId: env.serviceNow.callerId,
    category: env.serviceNow.category,
    closeCode: env.serviceNow.closeCode,
  };
}

export function source(): IncidentSource {
  const c = config();
  return c.configured ? { mode: 'servicenow', instance: c.baseUrl } : { mode: 'demo' };
}

export const toRef = (i: Incident): IncidentRef => ({
  sysId: i.sysId,
  number: i.number,
  state: i.state,
  stateCode: i.stateCode,
  priority: i.priority,
  priorityCode: i.priorityCode,
  url: i.url,
  openedAt: i.openedAt,
});

const errorIdFrom = (corr?: string) => (corr?.startsWith(PREFIX) ? corr.slice(PREFIX.length) : undefined);

/* ------------------------------------------------------------------ */
/* ServiceNow (real)                                                   */
/* ------------------------------------------------------------------ */

async function sn(pathname: string, init: RequestInit = {}) {
  const c = config();
  const res = await fetch(`${c.baseUrl}${pathname}`, {
    ...init,
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: c.auth!, ...(init.headers ?? {}) },
    cache: 'no-store',
  });
  if (!res.ok) {
    let detail = '';
    try {
      const j = await res.json();
      detail = j?.error?.message ?? j?.error?.detail ?? '';
    } catch {}
    throw new Error(`ServiceNow ${res.status}${detail ? `: ${detail}` : ''}`);
  }
  return res.json();
}

const FIELDS = [
  'sys_id',
  'number',
  'short_description',
  'description',
  'state',
  'priority',
  'urgency',
  'impact',
  'assigned_to',
  'assignment_group',
  'opened_at',
  'sys_created_on',
  'sys_updated_on',
  'resolved_at',
  'correlation_id',
].join(',');

type DV = { value: string; display_value: string } | string | undefined;
const val = (x: DV) => (x && typeof x === 'object' ? x.value : (x ?? ''));
const disp = (x: DV) => (x && typeof x === 'object' ? x.display_value : (x ?? ''));
// sysparm_display_value=all → `value` of date fields is UTC "YYYY-MM-DD HH:mm:ss"
const date = (x: DV) => {
  const v = val(x);
  return v ? Date.parse(v.replace(' ', 'T') + 'Z') : 0;
};

function mapSn(r: Record<string, DV>): Incident {
  const c = config();
  const stateCode = Number(val(r.state)) || 1;
  const priorityCode = Number(val(r.priority)) || 3;
  const corr = val(r.correlation_id);
  return {
    sysId: val(r.sys_id),
    number: disp(r.number) || val(r.number),
    shortDescription: disp(r.short_description),
    description: disp(r.description),
    state: disp(r.state) || STATES[stateCode] || String(stateCode),
    stateCode,
    priority: disp(r.priority) || PRIORITIES[priorityCode],
    priorityCode,
    urgency: Number(val(r.urgency)) || 3,
    impact: Number(val(r.impact)) || 3,
    assignedTo: disp(r.assigned_to) || undefined,
    assignmentGroup: disp(r.assignment_group) || undefined,
    openedAt: date(r.opened_at) || date(r.sys_created_on),
    updatedAt: date(r.sys_updated_on),
    resolvedAt: date(r.resolved_at) || undefined,
    correlationId: corr,
    errorId: errorIdFrom(corr),
    url: `${c.baseUrl}/nav_to.do?uri=incident.do?sys_id=${val(r.sys_id)}`,
  };
}

let cache: { at: number; items: Incident[] } | null = null;

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

export async function listIncidents(force = false): Promise<{ source: IncidentSource; incidents: Incident[] }> {
  const src = source();
  if (src.mode === 'demo') return { source: src, incidents: await listLocalIncidents() };
  if (!force && cache && Date.now() - cache.at < 10_000) return { source: src, incidents: cache.items };
  try {
    const q = encodeURIComponent(`correlation_idSTARTSWITH${PREFIX}^ORDERBYDESCsys_created_on`);
    const j = await sn(
      `/api/now/table/incident?sysparm_query=${q}&sysparm_limit=500&sysparm_display_value=all&sysparm_exclude_reference_link=true&sysparm_fields=${FIELDS}`,
    );
    const items = (j.result as Record<string, DV>[]).map(mapSn);
    cache = { at: Date.now(), items };
    return { source: src, incidents: items };
  } catch (e) {
    return { source: { ...src, error: (e as Error).message }, incidents: cache?.items ?? [] };
  }
}

/** ServiceNow sys_ids are 32 hex characters; anything else could smuggle operators into an encoded query. */
const SYS_ID = /^[0-9a-f]{32}$/i;

export async function getIncident(sysId: string): Promise<Incident | undefined> {
  const src = source();
  if (src.mode === 'demo') return getLocalIncident(sysId);
  if (!SYS_ID.test(sysId)) return undefined;
  const j = await sn(
    `/api/now/table/incident/${encodeURIComponent(sysId)}?sysparm_display_value=all&sysparm_exclude_reference_link=true&sysparm_fields=${FIELDS}`,
  );
  const inc = mapSn(j.result);
  try {
    const q = encodeURIComponent(`element_id=${sysId}^element=work_notes^ORDERBYDESCsys_created_on`);
    const notes = await sn(
      `/api/now/table/sys_journal_field?sysparm_query=${q}&sysparm_limit=50&sysparm_fields=value,sys_created_on,sys_created_by`,
    );
    inc.workNotes = (notes.result as Record<string, string>[]).map((n) => ({
      at: date(n.sys_created_on),
      author: n.sys_created_by,
      text: n.value,
    }));
  } catch {
    /* journal table may be restricted for this user */
  }
  return inc;
}

/** Map error group id → most relevant incident (open ones win over resolved). */
export async function incidentsByErrorId(): Promise<Map<string, Incident>> {
  const { incidents } = await listIncidents();
  const out = new Map<string, Incident>();
  for (const i of incidents) {
    if (!i.errorId) continue;
    const cur = out.get(i.errorId);
    const open = (x: Incident) => x.stateCode < 6;
    if (!cur || (open(i) && !open(cur)) || (open(i) === open(cur) && i.openedAt > cur.openedAt)) out.set(i.errorId, i);
  }
  return out;
}

export interface CreateIncidentInput {
  errorId: string;
  shortDescription: string;
  description: string;
  urgency: number;
  impact: number;
  assignmentGroup?: string;
}

export async function createIncident(input: CreateIncidentInput): Promise<Incident> {
  const src = source();
  const c = config();
  const urgency = Math.min(3, Math.max(1, Math.round(input.urgency)));
  const impact = Math.min(3, Math.max(1, Math.round(input.impact)));
  if (src.mode === 'demo') {
    const { seq, number } = await nextIncidentNumber();
    const now = Date.now();
    const pc = priorityOf(urgency, impact);
    const inc: Incident = {
      sysId: `demo-${seq}`,
      number,
      shortDescription: input.shortDescription,
      description: input.description,
      state: STATES[1],
      stateCode: 1,
      priority: PRIORITIES[pc],
      priorityCode: pc,
      urgency,
      impact,
      assignmentGroup: input.assignmentGroup || c.assignmentGroup,
      openedAt: now,
      updatedAt: now,
      correlationId: PREFIX + input.errorId,
      errorId: input.errorId,
      workNotes: [{ at: now, author: 'stacklens', text: 'Incident created from StackLens error group.' }],
    };
    return saveLocalIncident(inc);
  }
  const body: Record<string, unknown> = {
    short_description: input.shortDescription.slice(0, 160),
    description: input.description,
    urgency: String(urgency),
    impact: String(impact),
    category: c.category,
    correlation_id: PREFIX + input.errorId,
    correlation_display: 'StackLens',
  };
  const group = input.assignmentGroup || c.assignmentGroup;
  if (group) body.assignment_group = group;
  if (c.callerId) body.caller_id = c.callerId;
  const j = await sn(`/api/now/table/incident?sysparm_display_value=all&sysparm_exclude_reference_link=true&sysparm_fields=${FIELDS}`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  cache = null;
  return mapSn(j.result);
}

export type IncidentAction = ({ action: 'note'; text: string } | { action: 'start' } | { action: 'resolve'; text: string }) & {
  author?: string;
};

export async function updateIncident(sysId: string, a: IncidentAction): Promise<Incident | undefined> {
  const src = source();
  const c = config();
  if (src.mode === 'demo') {
    const inc = await getLocalIncident(sysId);
    if (!inc) return undefined;
    const now = Date.now();
    const note = (text: string): WorkNote => ({ at: now, author: a.author?.slice(0, 60) || 'you', text });
    inc.workNotes ??= [];
    if (a.action === 'note') inc.workNotes.push(note(a.text));
    if (a.action === 'start') {
      inc.stateCode = 2;
      inc.state = STATES[2];
      inc.workNotes.push(note('Work started.'));
    }
    if (a.action === 'resolve') {
      inc.stateCode = 6;
      inc.state = STATES[6];
      inc.resolvedAt = now;
      inc.workNotes.push(note(`Resolved: ${a.text || c.closeCode}`));
    }
    inc.updatedAt = now;
    return saveLocalIncident(inc);
  }
  if (!SYS_ID.test(sysId)) return undefined;

  const body =
    a.action === 'note'
      ? { work_notes: a.text }
      : a.action === 'start'
        ? { state: '2' }
        : { state: '6', close_code: c.closeCode, close_notes: a.text || 'Resolved from StackLens' };
  await sn(`/api/now/table/incident/${encodeURIComponent(sysId)}`, { method: 'PATCH', body: JSON.stringify(body) });
  cache = null;
  return getIncident(sysId);
}
