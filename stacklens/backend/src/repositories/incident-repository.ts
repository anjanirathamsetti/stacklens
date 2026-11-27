import 'server-only';
import type { Incident, WorkNote } from '@stacklens/shared/api-types';
import { getDb, type Db } from '../db/client';

/** Incidents created in demo mode (real ServiceNow incidents are read from ServiceNow). */

interface IncidentRow {
  sys_id: string;
  number: string;
  short_description: string;
  description: string | null;
  state: string;
  state_code: number;
  priority: string;
  priority_code: number;
  urgency: number;
  impact: number;
  assigned_to: string | null;
  assignment_group: string | null;
  opened_at: Date | string;
  updated_at: Date | string;
  resolved_at: Date | string | null;
  correlation_id: string | null;
  error_id: string | null;
  work_notes: WorkNote[];
}

const ms = (d: Date | string) => new Date(d).getTime();
const iso = (n: number | undefined) => (n === undefined ? null : new Date(n).toISOString());

function toIncident(r: IncidentRow): Incident {
  return {
    sysId: r.sys_id,
    number: r.number,
    shortDescription: r.short_description,
    description: r.description ?? undefined,
    state: r.state,
    stateCode: r.state_code,
    priority: r.priority,
    priorityCode: r.priority_code,
    urgency: r.urgency,
    impact: r.impact,
    assignedTo: r.assigned_to ?? undefined,
    assignmentGroup: r.assignment_group ?? undefined,
    openedAt: ms(r.opened_at),
    updatedAt: ms(r.updated_at),
    resolvedAt: r.resolved_at ? ms(r.resolved_at) : undefined,
    correlationId: r.correlation_id ?? undefined,
    errorId: r.error_id ?? undefined,
    workNotes: r.work_notes,
  };
}

function toRow(i: Incident) {
  return {
    sys_id: i.sysId,
    number: i.number,
    short_description: i.shortDescription,
    description: i.description ?? null,
    state: i.state,
    state_code: i.stateCode,
    priority: i.priority,
    priority_code: i.priorityCode,
    urgency: i.urgency,
    impact: i.impact,
    assigned_to: i.assignedTo ?? null,
    assignment_group: i.assignmentGroup ?? null,
    opened_at: iso(i.openedAt),
    updated_at: iso(i.updatedAt),
    resolved_at: iso(i.resolvedAt),
    correlation_id: i.correlationId ?? null,
    error_id: i.errorId ?? null,
    work_notes: i.workNotes ?? [],
  };
}

const RECORDSET = `sys_id text, number text, short_description text, description text, state text, state_code integer,
  priority text, priority_code integer, urgency integer, impact integer, assigned_to text, assignment_group text,
  opened_at timestamptz, updated_at timestamptz, resolved_at timestamptz, correlation_id text, error_id text, work_notes jsonb`;

export async function listLocalIncidents(): Promise<Incident[]> {
  const db = await getDb();
  return (await db.query<IncidentRow>('select * from incidents order by opened_at desc')).map(toIncident);
}

export async function getLocalIncident(sysId: string): Promise<Incident | undefined> {
  const db = await getDb();
  const [r] = await db.query<IncidentRow>('select * from incidents where sys_id = $1', [sysId]);
  return r ? toIncident(r) : undefined;
}

/** Next demo incident number, e.g. `{ seq: 10002, number: 'INC0010002' }`. */
export async function nextIncidentNumber(): Promise<{ seq: number; number: string }> {
  const db = await getDb();
  const [{ seq }] = await db.query<{ seq: string }>(`select nextval('incident_number_seq') as seq`);
  return { seq: Number(seq), number: `INC${String(seq).padStart(7, '0')}` };
}

/** Insert or replace incidents (used for create, update and the legacy import). */
export async function insertIncidentRows(db: Db, incidents: Incident[]): Promise<void> {
  if (!incidents.length) return;
  await db.query(
    `insert into incidents select * from jsonb_to_recordset($1::jsonb) as x(${RECORDSET})
     on conflict (sys_id) do update set
       state = excluded.state, state_code = excluded.state_code, updated_at = excluded.updated_at,
       resolved_at = excluded.resolved_at, work_notes = excluded.work_notes, assigned_to = excluded.assigned_to,
       assignment_group = excluded.assignment_group`,
    [JSON.stringify(incidents.map(toRow))],
  );
  // keep the number sequence ahead of imported numbers
  await db.query(
    `select setval('incident_number_seq', greatest((select coalesce(max(substring(number from 4)::bigint), 10000) from incidents), (select last_value from incident_number_seq)))`,
  );
}

export async function saveLocalIncident(incident: Incident): Promise<Incident> {
  await insertIncidentRows(await getDb(), [incident]);
  return incident;
}
