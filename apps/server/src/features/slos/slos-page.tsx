'use client';
import { Suspense, useState } from 'react';
import { useCan } from '@/lib/current-user';
import Link from 'next/link';
import { Activity, MoreHorizontal, Pencil, Plus, Target, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Tooltip } from '@/components/ui/tooltip';
import { toast } from '@/components/ui/toast';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { MethodBadge, AppBadge } from '@/components/data-display/trace-badges';
import { ShareMenu, ViewsMenu } from '@/components/layout/view-controls';
import { useLive } from '@/components/layout/providers';
import { useLiveRefresh } from '@/lib/url-filters';
import { sendJson, useResource } from '@/lib/use-resource';
import { cn, formatMs } from '@/lib/utils';
import type { SloObjective, SloState, SloStatus } from '@/lib/api-types';
import { SloDialog } from './components/slo-dialog';
import { pct, STATE_META } from './slo-format';

const SLOS_URL = '/api/slos';

function StateBadge({ state }: { state: SloState }) {
  const m = STATE_META[state];
  return (
    <Badge tone={m.tone}>
      <span className={cn('size-1.5 rounded-full', m.dot)} />
      {m.label}
    </Badge>
  );
}

function BudgetBar({ left }: { left: number }) {
  const v = Math.max(0, Math.min(1, left));
  const color = left < 0 ? 'bg-destructive' : left < 0.25 ? 'bg-warning' : 'bg-success';
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <div className={cn('h-full rounded-full transition-[width]', color)} style={{ width: `${v * 100}%` }} />
    </div>
  );
}

function Objective({ title, detail, o, hasData }: { title: string; detail: string; o: SloObjective; hasData: boolean }) {
  const met = o.attained >= o.target;
  return (
    <div className="min-w-0 space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">{title}</span>
        <span className="text-[11px] text-muted-foreground">target {pct(o.target)}</span>
      </div>
      <div className="flex items-baseline gap-2">
        <span
          className={cn(
            'font-mono text-xl font-semibold tabular-nums',
            hasData ? (met ? 'text-foreground' : 'text-destructive') : 'text-muted-foreground',
          )}
        >
          {hasData ? pct(o.attained, 2) : '—'}
        </span>
        <span className="truncate text-xs text-muted-foreground">{detail}</span>
      </div>
      <div className="space-y-1">
        <BudgetBar left={hasData ? o.budgetLeft : 1} />
        <div className="flex justify-between text-[11px] text-muted-foreground">
          <span>
            Error budget{' '}
            <span
              className={cn(
                'font-medium',
                o.budgetLeft < 0 ? 'text-destructive' : o.budgetLeft < 0.25 ? 'text-warning' : 'text-foreground',
              )}
            >
              {o.budgetLeft < 0 ? `overspent by ${pct(-o.budgetLeft, 0)}` : `${pct(o.budgetLeft, 0)} left`}
            </span>
          </span>
          <Tooltip content="How fast the budget burned in the last hour. 1× uses it up exactly at the end of the window.">
            <span className={cn(o.burnRate1h > 2 && 'font-medium text-warning', o.burnRate1h > 10 && 'text-destructive')}>
              burn {o.burnRate1h.toFixed(o.burnRate1h < 10 ? 1 : 0)}× /1h
            </span>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}

/** One bar per day: height = requests, colour = whether both objectives were met that day. */
function DailyBars({ s }: { s: SloStatus }) {
  const max = Math.max(1, ...s.daily.map((d) => d.total));
  return (
    <div className="flex h-10 items-end gap-[3px]">
      {s.daily.map((d) => {
        const fast = d.total ? d.fast / d.total : 1;
        const avail = d.total ? d.available / d.total : 1;
        const ok = fast >= s.latencyTarget && avail >= s.availabilityTarget;
        return (
          <Tooltip
            key={d.day}
            content={
              <div className="space-y-0.5">
                <div className="font-medium">
                  {new Date(d.day).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}
                </div>
                {d.total ? (
                  <>
                    <div>{d.total.toLocaleString()} requests</div>
                    <div>
                      {pct(fast, 2)} fast · {pct(avail, 2)} available
                    </div>
                  </>
                ) : (
                  <div>No traffic</div>
                )}
              </div>
            }
          >
            <div
              className={cn(
                'min-w-[4px] flex-1 rounded-sm',
                !d.total ? 'bg-muted' : ok ? 'bg-success/70 hover:bg-success' : 'bg-destructive/70 hover:bg-destructive',
              )}
              style={{ height: `${d.total ? Math.max(12, (d.total / max) * 100) : 8}%` }}
            />
          </Tooltip>
        );
      })}
    </div>
  );
}

function SloCard({ s, onEdit, onDelete }: { s: SloStatus; onEdit: () => void; onDelete: () => void }) {
  const canWrite = useCan('member');
  const q = new URLSearchParams({ app: s.application, route: s.route, range: s.windowDays === 1 ? '24h' : `${s.windowDays}d` });
  if (s.method) q.set('method', s.method);
  const tracesHref = `/traces?${q}`;
  const hasData = s.total > 0;
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
        <div className={cn('size-2 shrink-0 rounded-full', STATE_META[s.state].dot)} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-semibold">{s.name}</span>
            <StateBadge state={s.state} />
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {s.method && <MethodBadge method={s.method} />}
            <span className="font-mono text-foreground/80">{s.route}</span>
            <AppBadge name={s.application} />
            <span>· {s.windowDays === 1 ? '1-day' : `${s.windowDays}-day`} window</span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Link href={tracesHref}>
            <Button variant="ghost" size="sm">
              <Activity /> Traces
            </Button>
          </Link>
          {canWrite && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="SLO actions">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40">
                <DropdownMenuItem onSelect={onEdit}>
                  <Pencil /> Edit
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={onDelete} className="text-destructive focus:text-destructive">
                  <Trash2 /> Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
      <div className="grid gap-5 p-4 md:grid-cols-[1fr_1fr_minmax(180px,0.8fr)]">
        <Objective title="Latency" detail={`of requests within ${formatMs(s.latencyMs)}`} o={s.latency} hasData={hasData} />
        <Objective title="Availability" detail="without a server error" o={s.availability} hasData={hasData} />
        <div className="min-w-0 space-y-2">
          <div className="flex items-baseline justify-between text-xs">
            <span className="font-medium text-muted-foreground">Daily</span>
            <span className="text-[11px] text-muted-foreground">
              {s.total.toLocaleString()} req · p95 {hasData ? formatMs(s.p95) : '—'}
            </span>
          </div>
          <DailyBars s={s} />
        </div>
      </div>
    </Card>
  );
}

function Summary({ slos }: { slos: SloStatus[] }) {
  const count = (st: SloState) => slos.filter((s) => s.state === st).length;
  const items: { label: string; value: number; state?: SloState }[] = [
    { label: 'Objectives', value: slos.length },
    { label: 'Healthy', value: count('healthy'), state: 'healthy' },
    { label: 'At risk', value: count('at-risk'), state: 'at-risk' },
    { label: 'Breached', value: count('breached'), state: 'breached' },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {items.map((i) => (
        <Card key={i.label} className="px-4 py-3">
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            {i.state && <span className={cn('size-1.5 rounded-full', STATE_META[i.state].dot)} />}
            {i.label}
          </div>
          <div
            className={cn(
              'mt-1 font-mono text-2xl font-semibold tabular-nums',
              i.state && i.value > 0 && i.state !== 'healthy' && STATE_META[i.state].text,
            )}
          >
            {i.value}
          </div>
        </Card>
      ))}
    </div>
  );
}

function SlosInner() {
  const canWrite = useCan('member');
  const { data, loading, reload } = useResource<{ slos: SloStatus[] }>(SLOS_URL);
  const { live } = useLive();
  useLiveRefresh(reload, live, 30_000);
  const [dialog, setDialog] = useState<{ open: boolean; editing?: SloStatus }>({ open: false });
  const slos = data?.slos ?? [];
  const order: Record<SloState, number> = { breached: 0, 'at-risk': 1, healthy: 2, 'no-data': 3 };
  const sorted = [...slos].sort((a, b) => order[a.state] - order[b.state] || a.name.localeCompare(b.name));

  const remove = async (s: SloStatus) => {
    if (!window.confirm(`Delete the SLO “${s.name}”? This can't be undone.`)) return;
    await sendJson(`${SLOS_URL}/${s.id}`, 'DELETE');
    toast(`Deleted “${s.name}”`);
    void reload();
  };

  return (
    <>
      <PageHeader title="SLOs" description="Latency and availability objectives per route, with error budgets">
        <ViewsMenu />
        <ShareMenu />
        {canWrite && (
          <Button onClick={() => setDialog({ open: true })}>
            <Plus /> New SLO
          </Button>
        )}
      </PageHeader>
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl space-y-4 p-6">
          {loading && !data ? (
            <div className="space-y-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-40 animate-pulse rounded-lg border bg-muted/30" />
              ))}
            </div>
          ) : slos.length === 0 ? (
            <Card className="flex flex-col items-center px-6 py-14 text-center">
              <div className="mb-3 grid size-11 place-items-center rounded-full bg-brand/10 text-brand">
                <Target className="size-5" />
              </div>
              <div className="text-sm font-semibold">No SLOs yet</div>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">
                Pick a route, say how fast it should be and how often it may fail. StackLens tracks attainment, the error budget left and
                how fast it is burning.
              </p>
              {canWrite ? (
                <Button className="mt-4" onClick={() => setDialog({ open: true })}>
                  <Plus /> Create your first SLO
                </Button>
              ) : (
                <p className="mt-3 text-xs text-muted-foreground">Ask a member or admin to create one.</p>
              )}
            </Card>
          ) : (
            <>
              <Summary slos={slos} />
              {sorted.map((s) => (
                <SloCard key={s.id} s={s} onEdit={() => setDialog({ open: true, editing: s })} onDelete={() => remove(s)} />
              ))}
            </>
          )}
        </div>
      </div>
      <SloDialog
        open={dialog.open}
        editing={dialog.editing}
        onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
        onSaved={() => {
          toast(dialog.editing ? 'SLO updated' : 'SLO created');
          void reload();
        }}
      />
    </>
  );
}

export default function SlosPage() {
  return (
    <Suspense>
      <SlosInner />
    </Suspense>
  );
}
