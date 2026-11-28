'use client';
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { PrintDocument, PrintStat } from '@/components/print/print-document';
import { PrintTable } from '@/components/print/print-table';
import { MAX_PRINT_ROWS, printDateTime, type PrintFilter } from '@/components/print/print-query';
import { usePrintData } from '@/components/print/use-print-data';
import { Badge } from '@/components/ui/badge';
import { auditLabel, auditTone } from '@/features/admin/audit-labels';
import { ROLE_LABELS } from '@/lib/current-user';
import { cn } from '@/lib/utils';
import type { ApiKeyInfo, AuditEntry, AuthUser, SecurityConfig } from '@stacklens/shared/api-types';

/** Admin tables as PDF. The routes sit under /print/admin, whose layout requires the admin role (as do the APIs). */

function UserStatus({ u }: { u: AuthUser }) {
  if (u.disabled) return <Badge tone="neutral">Disabled</Badge>;
  if (u.mustChangePassword) return <Badge tone="warning">Invited</Badge>;
  return <Badge tone="success">Active</Badge>;
}

function UsersReportInner() {
  const sp = useSearchParams();
  const query = sp.get('q') ?? '';
  const { data, error, fetchedAt } = usePrintData<{ u: { users: AuthUser[] } }>({ u: '/api/admin/users' });
  const users = data?.u.users ?? [];
  const shown = users.filter((u) => !query || `${u.name} ${u.email}`.toLowerCase().includes(query.toLowerCase()));
  const filters: PrintFilter[] = query ? [{ label: 'Search', value: query }] : [];
  return (
    <PrintDocument
      title="Users"
      subtitle="Who can sign in to StackLens, and what they can do"
      filters={filters}
      notes={data ? [`${shown.length} of ${users.length} users.`] : []}
      generatedAt={fetchedAt}
      ready={!!data}
      error={error}
    >
      <div className="grid grid-cols-3 gap-2.5">
        <PrintStat label="Users" value={users.length} />
        <PrintStat label="Admins" value={users.filter((u) => u.role === 'admin' && !u.disabled).length} />
        <PrintStat label="Disabled" value={users.filter((u) => u.disabled).length} />
      </div>
      <PrintTable
        rows={shown}
        rowKey={(u) => u.id}
        empty="No users match."
        columns={[
          {
            header: 'User',
            width: '40%',
            cell: (u) => (
              <>
                <div className={cn('font-medium', u.disabled && 'text-muted-foreground')}>{u.name}</div>
                <div className="break-all text-[10px] text-muted-foreground">{u.email}</div>
              </>
            ),
          },
          { header: 'Role', cell: (u) => ROLE_LABELS[u.role].label },
          { header: 'Status', cell: (u) => <UserStatus u={u} /> },
          { header: 'Created', cell: (u) => <span className="text-[10px]">{printDateTime(u.createdAt)}</span> },
          {
            header: 'Last sign-in',
            cell: (u) => <span className="text-[10px]">{u.lastLoginAt ? printDateTime(u.lastLoginAt) : 'Never'}</span>,
          },
        ]}
      />
    </PrintDocument>
  );
}

function ApiKeysReportInner() {
  const { data, error, fetchedAt } = usePrintData<{ k: { keys: ApiKeyInfo[] }; s: { config: SecurityConfig } }>({
    k: '/api/admin/api-keys',
    s: '/api/config/security',
  });
  const keys = data?.k.keys ?? [];
  const required = data?.s.config.requireIngestKey ?? false;
  return (
    <PrintDocument
      title="API keys"
      subtitle="Keys your instrumented apps use to send traces"
      filters={data ? [{ label: 'Ingest', value: required ? 'API key required' : 'Traces accepted without a key' }] : []}
      notes={['Only the first characters of each key are shown; StackLens stores keys as hashes.']}
      generatedAt={fetchedAt}
      ready={!!data}
      error={error}
    >
      <div className="grid grid-cols-3 gap-2.5">
        <PrintStat label="Active keys" value={keys.filter((k) => !k.revokedAt).length} />
        <PrintStat label="Revoked" value={keys.filter((k) => k.revokedAt).length} />
        <PrintStat label="Require a key" value={required ? 'On' : 'Off'} tone={required ? 'success' : 'warning'} />
      </div>
      <PrintTable
        rows={keys}
        rowKey={(k) => k.id}
        empty="No API keys yet."
        columns={[
          {
            header: 'Name',
            width: '30%',
            cell: (k) => (
              <>
                <div className="font-medium">{k.name}</div>
                {k.createdBy && <div className="text-[10px] text-muted-foreground">by {k.createdBy}</div>}
              </>
            ),
          },
          { header: 'Key', cell: (k) => <span className="font-mono">{k.prefix}…</span> },
          { header: 'Created', cell: (k) => <span className="text-[10px]">{printDateTime(k.createdAt)}</span> },
          { header: 'Last used', cell: (k) => <span className="text-[10px]">{k.lastUsedAt ? printDateTime(k.lastUsedAt) : 'Never'}</span> },
          {
            header: 'Status',
            cell: (k) =>
              k.revokedAt ? <Badge tone="neutral">Revoked {printDateTime(k.revokedAt)}</Badge> : <Badge tone="success">Active</Badge>,
          },
        ]}
      />
    </PrintDocument>
  );
}

/** The Audit log page shows the latest 300 events; the table export takes up to MAX_PRINT_ROWS. */
const AUDIT_PAGE_LIMIT = 300;

function AuditReportInner() {
  const sp = useSearchParams();
  const query = sp.get('q') ?? '';
  const hideSignIns = sp.get('hideSignIns') === 'true';
  const limit = sp.get('scope') === 'all' ? MAX_PRINT_ROWS : AUDIT_PAGE_LIMIT;
  const { data, error, fetchedAt } = usePrintData<{ a: { entries: AuditEntry[] } }>({ a: `/api/admin/audit?limit=${limit}` });
  const all = data?.a.entries ?? [];
  const entries = all.filter(
    (e) =>
      (!hideSignIns || !['login', 'logout'].includes(e.action)) &&
      (!query || `${e.actorEmail} ${e.target} ${auditLabel(e.action)}`.toLowerCase().includes(query.toLowerCase())),
  );
  const filters: PrintFilter[] = [];
  if (query) filters.push({ label: 'Search', value: query });
  if (hideSignIns) filters.push({ label: 'Sign-ins', value: 'hidden' });
  return (
    <PrintDocument
      title="Audit log"
      landscape
      subtitle="Sign-ins and changes to users, keys and settings"
      filters={filters}
      notes={
        data ? [`${entries.length.toLocaleString()} events shown, from the latest ${all.length.toLocaleString()} (limit ${limit}).`] : []
      }
      generatedAt={fetchedAt}
      ready={!!data}
      error={error}
    >
      <PrintTable
        rows={entries}
        rowKey={(e) => String(e.id)}
        empty="No events."
        columns={[
          { header: 'Time', width: '17%', cell: (e) => <span className="font-mono text-[10px]">{printDateTime(e.at, true)}</span> },
          {
            header: 'Who',
            width: '22%',
            cell: (e) => (
              <>
                <div className="break-all font-medium">{e.actorEmail ?? 'System'}</div>
                {e.ip && <div className="font-mono text-[9.5px] text-muted-foreground">{e.ip}</div>}
              </>
            ),
          },
          {
            header: 'Action',
            width: '26%',
            cell: (e) => (
              <span className="flex items-start gap-1.5">
                <span className={cn('mt-1 size-1.5 shrink-0 rounded-full', auditTone(e.action))} />
                {auditLabel(e.action)}
              </span>
            ),
          },
          {
            header: 'Target & details',
            cell: (e) => (
              <>
                {e.target && <div className="break-all font-mono text-[10px]">{e.target}</div>}
                {Object.keys(e.details).length > 0 && (
                  <div className="break-all font-mono text-[9.5px] text-muted-foreground">
                    {Object.entries(e.details)
                      .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
                      .join(' · ')}
                  </div>
                )}
              </>
            ),
          },
        ]}
      />
    </PrintDocument>
  );
}

export function UsersReport() {
  return (
    <Suspense>
      <UsersReportInner />
    </Suspense>
  );
}
export function ApiKeysReport() {
  return (
    <Suspense>
      <ApiKeysReportInner />
    </Suspense>
  );
}
export function AuditReport() {
  return (
    <Suspense>
      <AuditReportInner />
    </Suspense>
  );
}
