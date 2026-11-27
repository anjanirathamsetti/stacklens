'use client';
import { useEffect, useMemo, useState } from 'react';
import { Target } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { MethodBadge } from '@/components/data-display/trace-badges';
import { useResource, sendJson } from '@/lib/use-resource';
import { formatMs } from '@/lib/utils';
import type { Slo, SloInput } from '@stacklens/shared/api-types';
import { pct, TARGETS, WINDOWS } from '@/features/slos/slo-format';

interface KnownRoute {
  application: string;
  method?: string;
  route: string;
  count: number;
  p95: number;
}

const routeKey = (r: Pick<KnownRoute, 'application' | 'method' | 'route'>) => `${r.application}|${r.method ?? ''}|${r.route}`;

/** Round a p95 up to a friendly threshold: 87 → 100, 340 → 400, 1800 → 2000. */
function suggestThreshold(p95: number) {
  if (!p95) return 300;
  const steps = [50, 100, 150, 200, 250, 300, 400, 500, 750, 1000, 1500, 2000, 3000, 5000, 10000];
  return steps.find((s) => s >= p95 * 1.1) ?? Math.ceil(p95 / 1000) * 1000;
}

export function SloDialog({
  open,
  onOpenChange,
  editing,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing?: Slo;
  onSaved: () => void;
}) {
  const { data } = useResource<{ routes: KnownRoute[] }>(open ? '/api/slos/routes' : null);
  const routes = useMemo(() => data?.routes ?? [], [data]);
  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [latencyMs, setLatencyMs] = useState(300);
  const [latencyTarget, setLatencyTarget] = useState(0.95);
  const [availabilityTarget, setAvailabilityTarget] = useState(0.999);
  const [windowDays, setWindowDays] = useState(7);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setError('');
    if (editing) {
      setKey(routeKey(editing));
      setName(editing.name);
      setLatencyMs(editing.latencyMs);
      setLatencyTarget(editing.latencyTarget);
      setAvailabilityTarget(editing.availabilityTarget);
      setWindowDays(editing.windowDays);
    } else {
      setKey('');
      setName('');
      setLatencyMs(300);
      setLatencyTarget(0.95);
      setAvailabilityTarget(0.999);
      setWindowDays(7);
    }
  }, [open, editing]);

  const selected =
    routes.find((r) => routeKey(r) === key) ??
    (editing && routeKey(editing) === key
      ? { application: editing.application, method: editing.method, route: editing.route, count: 0, p95: 0 }
      : undefined);

  const pickRoute = (k: string) => {
    setKey(k);
    const r = routes.find((x) => routeKey(x) === k);
    if (!r) return;
    if (!name || routes.some((x) => `${x.method ? x.method + ' ' : ''}${x.route}` === name))
      setName(`${r.method ? r.method + ' ' : ''}${r.route}`);
    setLatencyMs(suggestThreshold(r.p95));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected) return setError('Pick a route');
    const body: SloInput = {
      name: name.trim() || `${selected.method ? selected.method + ' ' : ''}${selected.route}`,
      application: selected.application,
      method: selected.method,
      route: selected.route,
      latencyMs,
      latencyTarget,
      availabilityTarget,
      windowDays,
    };
    setBusy(true);
    setError('');
    try {
      await sendJson(editing ? `/api/slos/${editing.id}` : '/api/slos', editing ? 'PUT' : 'POST', body);
      onSaved();
      onOpenChange(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const budgetRequests = (t: number) => `${pct(1 - t)} of requests`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(560px,calc(100vw-32px))]">
        <form onSubmit={submit}>
          <div className="mb-4 flex items-start gap-3 pr-8">
            <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand/10 text-brand">
              <Target className="size-4.5" />
            </div>
            <div>
              <DialogTitle>{editing ? 'Edit SLO' : 'New SLO'}</DialogTitle>
              <DialogDescription>Set a latency and availability target for one route.</DialogDescription>
            </div>
          </div>
          <div className="space-y-4">
            <label className="block space-y-1.5">
              <span className="text-xs font-medium">Route</span>
              <Select value={key} onChange={(e) => pickRoute(e.target.value)} className="w-full" searchable>
                <option value="">Pick a route seen in the last 7 days…</option>
                {editing && !routes.some((r) => routeKey(r) === routeKey(editing)) && (
                  <option value={routeKey(editing)}>
                    {editing.method} {editing.route} · {editing.application}
                  </option>
                )}
                {routes.map((r) => (
                  <option key={routeKey(r)} value={routeKey(r)}>
                    {r.method ? `${r.method} ` : ''}
                    {r.route} · {r.application} · {r.count.toLocaleString()} req · p95 {formatMs(r.p95)}
                  </option>
                ))}
              </Select>
              {selected && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  {selected.method && <MethodBadge method={selected.method} />}
                  <span className="font-mono">{selected.route}</span>
                  <span>in {selected.application}</span>
                  {selected.p95 > 0 && <span>· current p95 {formatMs(selected.p95)}</span>}
                </div>
              )}
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-medium">Name</span>
              <Input value={name} maxLength={80} placeholder="e.g. Checkout is fast" onChange={(e) => setName(e.target.value)} />
            </label>

            <div className="rounded-lg border">
              <div className="border-b px-3 py-2 text-xs font-semibold">Latency objective</div>
              <div className="grid grid-cols-2 gap-3 p-3">
                <label className="block space-y-1.5">
                  <span className="text-xs text-muted-foreground">Fast means within</span>
                  <div className="relative">
                    <Input
                      type="number"
                      min={1}
                      value={latencyMs}
                      onChange={(e) => setLatencyMs(Number(e.target.value))}
                      className="pr-9"
                    />
                    <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                      ms
                    </span>
                  </div>
                </label>
                <label className="block space-y-1.5">
                  <span className="text-xs text-muted-foreground">Share of requests that must be fast</span>
                  <Select value={String(latencyTarget)} onChange={(e) => setLatencyTarget(Number(e.target.value))} className="w-full">
                    {TARGETS.map((t) => (
                      <option key={t} value={t}>
                        {pct(t)}
                      </option>
                    ))}
                  </Select>
                </label>
              </div>
            </div>

            <div className="rounded-lg border">
              <div className="border-b px-3 py-2 text-xs font-semibold">Availability objective</div>
              <div className="grid grid-cols-2 gap-3 p-3">
                <label className="block space-y-1.5">
                  <span className="text-xs text-muted-foreground">Requests without a server error (5xx)</span>
                  <Select
                    value={String(availabilityTarget)}
                    onChange={(e) => setAvailabilityTarget(Number(e.target.value))}
                    className="w-full"
                  >
                    {TARGETS.map((t) => (
                      <option key={t} value={t}>
                        {pct(t)}
                      </option>
                    ))}
                  </Select>
                </label>
                <label className="block space-y-1.5">
                  <span className="text-xs text-muted-foreground">Rolling window</span>
                  <Select value={String(windowDays)} onChange={(e) => setWindowDays(Number(e.target.value))} className="w-full">
                    {WINDOWS.map((w) => (
                      <option key={w} value={w}>
                        {w === 1 ? '1 day' : `${w} days`}
                      </option>
                    ))}
                  </Select>
                </label>
              </div>
            </div>
            <div className="rounded-md bg-muted/50 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
              Error budget: up to <span className="font-medium text-foreground">{budgetRequests(latencyTarget)}</span> may be slower than{' '}
              {formatMs(latencyMs)} and <span className="font-medium text-foreground">{budgetRequests(availabilityTarget)}</span> may fail
              over {windowDays === 1 ? 'a day' : `${windowDays} days`}.
            </div>
            {error && <div className="text-xs text-destructive">{error}</div>}
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !selected}>
              {editing ? 'Save changes' : 'Create SLO'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
