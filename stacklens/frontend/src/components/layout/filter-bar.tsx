'use client';
import { useEffect, useState } from 'react';
import { Boxes, FolderKanban, Pause, Play, RefreshCw, Server, User, X, ZoomOut, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/input';
import { Tooltip } from '@/components/ui/tooltip';
import { TimeRangePicker } from '@/components/layout/time-range-picker';
import { ShareMenu, ViewsMenu } from '@/components/layout/view-controls';
import { useLive } from '@/components/layout/providers';
import { useFilters } from '@/lib/url-filters';
import { cn } from '@/lib/utils';
import type { Facets } from '@stacklens/shared/api-types';

let facetsCache: Facets | null = null;

export function useFacets() {
  const [facets, setFacets] = useState<Facets | null>(facetsCache);
  useEffect(() => {
    const load = () =>
      fetch('/api/facets', { cache: 'no-store' })
        .then((r) => r.json())
        .then((f: Facets) => {
          facetsCache = f;
          setFacets(f);
        })
        .catch(() => {});
    load();
    const iv = setInterval(load, 30_000);
    return () => clearInterval(iv);
  }, []);
  return facets;
}

function LabeledSelect({
  icon,
  value,
  onChange,
  placeholder,
  options,
}: {
  icon: React.ComponentType<{ className?: string }>;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  options: string[];
}) {
  return (
    <Select
      icon={icon}
      value={value}
      clearable
      onChange={(e) => onChange(e.target.value)}
      className={cn('w-44', value && 'border-brand/40 bg-brand/[0.05]')}
    >
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </Select>
  );
}

/** Global filters shared by all pages: project, application, environment, user, time range, live. */
export function FilterBar({ onRefresh, children }: { onRefresh?: () => void; children?: React.ReactNode }) {
  const { range, values, set } = useFilters();
  const facets = useFacets();
  const { live, setLive } = useLive();
  const [user, setUser] = useState(values.user);

  useEffect(() => setUser(values.user), [values.user]);
  useEffect(() => {
    if (user === values.user) return;
    const id = setTimeout(() => set({ user }), 350);
    return () => clearTimeout(id);
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  const apps = values.project ? (facets?.projectApps[values.project] ?? []) : (facets?.applications ?? []);
  const anyFilter = values.project || values.app || values.env || values.user;

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-background px-6 py-2.5">
      <LabeledSelect
        icon={FolderKanban}
        value={values.project}
        placeholder="All projects"
        options={facets?.projects ?? []}
        onChange={(v) => set({ project: v, app: v && values.app && !facets?.projectApps[v]?.includes(values.app) ? '' : values.app })}
      />
      <LabeledSelect icon={Boxes} value={values.app} placeholder="All applications" options={apps} onChange={(v) => set({ app: v })} />
      {(facets?.environments.length ?? 0) > 1 && (
        <LabeledSelect
          icon={Server}
          value={values.env}
          placeholder="All environments"
          options={facets?.environments ?? []}
          onChange={(v) => set({ env: v })}
        />
      )}
      <div className="relative">
        <User className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          value={user}
          onChange={(e) => setUser(e.target.value)}
          placeholder="User ID"
          className={cn(
            'h-8 w-36 rounded-md border border-input bg-card pl-8 pr-7 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
            values.user && 'border-brand/50 bg-brand/5',
          )}
        />
        {user && (
          <button
            onClick={() => setUser('')}
            className="absolute right-1.5 top-1/2 grid size-5 -translate-y-1/2 place-items-center rounded text-muted-foreground hover:text-foreground cursor-pointer"
            aria-label="Clear user"
          >
            <X className="size-3" />
          </button>
        )}
      </div>
      {anyFilter && (
        <Button variant="ghost" size="sm" onClick={() => set({ project: '', app: '', env: '', user: '' })}>
          Clear filters
        </Button>
      )}
      {children}
      <div className="ml-auto flex items-center gap-2">
        <ViewsMenu />
        {range.kind === 'absolute' && (
          <>
            <Tooltip content="Zoom out (double the window)">
              <Button
                variant="outline"
                size="icon"
                onClick={() => {
                  const span = range.to - range.from;
                  const to = Math.min(Date.now(), range.to + span / 2);
                  set({ range: 'abs', from: Math.round(to - span * 2), to: Math.round(to) });
                }}
              >
                <ZoomOut />
              </Button>
            </Tooltip>
            <Tooltip content="Back to last 1 hour (live)">
              <Button variant="outline" size="icon" onClick={() => set({ range: '1h', from: undefined, to: undefined })}>
                <Undo2 />
              </Button>
            </Tooltip>
          </>
        )}
        <TimeRangePicker range={range} onChange={set} />
        <Tooltip content={live ? 'Live: auto-refreshing as traces arrive. Click to pause.' : 'Paused. Click to resume live updates.'}>
          <Button variant="outline" onClick={() => setLive(!live)} className={cn(live && 'border-success/40')}>
            {live ? (
              <>
                <span className="size-1.5 rounded-full bg-success animate-pulse-dot" /> Live <Pause className="text-muted-foreground" />
              </>
            ) : (
              <>
                <Play /> Paused
              </>
            )}
          </Button>
        </Tooltip>
        <ShareMenu />
        {onRefresh && (
          <Tooltip content="Refresh now">
            <Button variant="outline" size="icon" onClick={onRefresh}>
              <RefreshCw />
            </Button>
          </Tooltip>
        )}
      </div>
    </div>
  );
}
