'use client';
import { Suspense } from 'react';
import { PrintDocument, PrintEmpty, PrintStat } from '@/components/print/print-document';
import { MiniBars, ShareBar } from '@/components/print/print-charts';
import { usePrintData } from '@/components/print/use-print-data';
import { AppBadge, MethodBadge } from '@/components/data-display/trace-badges';
import { Badge } from '@/components/ui/badge';
import { pct, STATE_META } from '@/features/slos/slo-format';
import { cn, formatMs } from '@/lib/utils';
import type { SloObjective, SloState, SloStatus } from '@stacklens/shared/api-types';

const ORDER: Record<SloState, number> = { breached: 0, 'at-risk': 1, healthy: 2, 'no-data': 3 };

function Objective({ title, detail, o, hasData }: { title: string; detail: string; o: SloObjective; hasData: boolean }) {
  const met = o.attained >= o.target;
  const budgetColor = o.budgetLeft < 0 ? 'var(--destructive)' : o.budgetLeft < 0.25 ? 'var(--warning)' : 'var(--success)';
  return (
    <div className="min-w-0 space-y-1">
      <div className="flex items-baseline justify-between text-[10.5px] text-muted-foreground">
        <span className="font-medium">{title}</span>
        <span>target {pct(o.target)}</span>
      </div>
      <div className="flex items-baseline gap-1.5">
        <span
          className={cn(
            'font-mono text-base font-semibold tabular-nums',
            hasData ? (met ? '' : 'text-destructive') : 'text-muted-foreground',
          )}
        >
          {hasData ? pct(o.attained, 2) : '—'}
        </span>
        <span className="text-[10px] text-muted-foreground">{detail}</span>
      </div>
      <ShareBar pct={(hasData ? Math.max(0, Math.min(1, o.budgetLeft)) : 1) * 100} color={budgetColor} />
      <div className="flex justify-between text-[9.5px] text-muted-foreground">
        <span>
          Error budget{' '}
          <span
            className={cn('font-medium', o.budgetLeft < 0 ? 'text-destructive' : o.budgetLeft < 0.25 ? 'text-warning' : 'text-foreground')}
          >
            {o.budgetLeft < 0 ? `overspent by ${pct(-o.budgetLeft, 0)}` : `${pct(o.budgetLeft, 0)} left`}
          </span>
        </span>
        <span>burn {o.burnRate1h.toFixed(o.burnRate1h < 10 ? 1 : 0)}× /1h</span>
      </div>
    </div>
  );
}

function SloBlock({ s }: { s: SloStatus }) {
  const hasData = s.total > 0;
  const colors = s.daily.map((d) => {
    if (!d.total) return 'var(--muted-foreground)';
    const ok = d.fast / d.total >= s.latencyTarget && d.available / d.total >= s.availabilityTarget;
    return ok ? 'var(--success)' : 'var(--destructive)';
  });
  return (
    <div className="break-inside-avoid rounded-lg border">
      <div className="flex items-start gap-2 border-b px-3 py-2">
        <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', STATE_META[s.state].dot)} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[12px] font-semibold">{s.name}</span>
            <Badge tone={STATE_META[s.state].tone}>{STATE_META[s.state].label}</Badge>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
            {s.method && <MethodBadge method={s.method} className="w-[46px]" />}
            <span className="break-all font-mono text-foreground/80">{s.route}</span>
            <AppBadge name={s.application} />
            <span>· {s.windowDays === 1 ? '1-day' : `${s.windowDays}-day`} window</span>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-[1fr_1fr_0.9fr] gap-4 px-3 py-2.5">
        <Objective title="Latency" detail={`within ${formatMs(s.latencyMs)}`} o={s.latency} hasData={hasData} />
        <Objective title="Availability" detail="no server error" o={s.availability} hasData={hasData} />
        <div className="min-w-0 space-y-1">
          <div className="flex items-baseline justify-between text-[10.5px] text-muted-foreground">
            <span className="font-medium">Daily</span>
            <span>
              {s.total.toLocaleString()} req · p95 {hasData ? formatMs(s.p95) : '—'}
            </span>
          </div>
          <MiniBars values={s.daily.map((d) => d.total)} colors={colors} width={170} height={30} />
          <div className="text-[9px] text-muted-foreground">green: both objectives met that day · red: missed · grey: no traffic</div>
        </div>
      </div>
    </div>
  );
}

function SlosReportInner() {
  const { data, error, fetchedAt } = usePrintData<{ s: { slos: SloStatus[] } }>({ s: '/api/slos' });
  const slos = data?.s.slos ?? [];
  const sorted = [...slos].sort((a, b) => ORDER[a.state] - ORDER[b.state] || a.name.localeCompare(b.name));
  const count = (st: SloState) => slos.filter((s) => s.state === st).length;

  return (
    <PrintDocument
      title="SLOs"
      subtitle="Latency and availability objectives per route, with error budgets"
      filters={[{ label: 'Window', value: 'Each SLO over its own rolling window' }]}
      generatedAt={fetchedAt}
      ready={!!data}
      error={error}
    >
      <div className="grid grid-cols-4 gap-2.5">
        <PrintStat label="Objectives" value={slos.length} />
        <PrintStat label="Healthy" value={count('healthy')} />
        <PrintStat label="At risk" value={count('at-risk')} tone={count('at-risk') ? 'warning' : undefined} />
        <PrintStat label="Breached" value={count('breached')} tone={count('breached') ? 'error' : undefined} />
      </div>
      {sorted.length ? (
        <div className="space-y-3">
          {sorted.map((s) => (
            <SloBlock key={s.id} s={s} />
          ))}
        </div>
      ) : (
        <PrintEmpty>No SLOs yet.</PrintEmpty>
      )}
    </PrintDocument>
  );
}

export default function SlosReport() {
  return (
    <Suspense>
      <SlosReportInner />
    </Suspense>
  );
}
