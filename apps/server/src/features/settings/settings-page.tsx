'use client';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTheme } from 'next-themes';
import { Check, Database, Gauge, Keyboard, Monitor, Moon, Palette, Plug, RotateCcw, Sun, Trash2, User } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { DEFAULT_SETTINGS, initials, useSettings } from '@/lib/settings-context';
import { cn, formatDateTime, formatMs } from '@/lib/utils';
import type { IncidentSource } from '@/lib/api-types';

const TABS = [
  { id: 'profile', label: 'Profile', icon: User },
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'thresholds', label: 'Health thresholds', icon: Gauge },
  { id: 'data', label: 'Data & storage', icon: Database },
  { id: 'integrations', label: 'Integrations', icon: Plug },
  { id: 'shortcuts', label: 'Keyboard shortcuts', icon: Keyboard },
] as const;
type TabId = (typeof TABS)[number]['id'];

function Section({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <Card className="overflow-hidden">
      <div className="border-b px-5 py-4">
        <div className="text-sm font-semibold">{title}</div>
        {description && <div className="mt-0.5 text-xs text-muted-foreground">{description}</div>}
      </div>
      <div className="space-y-4 px-5 py-4">{children}</div>
      {footer && <div className="flex items-center justify-end gap-2 border-t bg-muted/30 px-5 py-3">{footer}</div>}
    </Card>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5 sm:grid-cols-[200px_1fr] sm:items-center sm:gap-6">
      <div>
        <div className="text-sm font-medium">{label}</div>
        {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
      </div>
      <div>{children}</div>
    </div>
  );
}

function useSaved() {
  const [saved, setSaved] = useState(false);
  const flash = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 1600);
  };
  return [saved, flash] as const;
}

function SavedNote({ show }: { show: boolean }) {
  return (
    <span className={cn('mr-auto flex items-center gap-1 text-xs text-success transition-opacity', show ? 'opacity-100' : 'opacity-0')}>
      <Check className="size-3.5" /> Saved
    </span>
  );
}

function ProfileTab() {
  const { settings, update } = useSettings();
  const [p, setP] = useState(settings.profile);
  const [saved, flash] = useSaved();
  useEffect(() => setP(settings.profile), [settings.profile]);
  const dirty = JSON.stringify(p) !== JSON.stringify(settings.profile);
  return (
    <Section
      title="Profile"
      description="Shown in the sidebar and used as the author of incident work notes. Stored in this browser only – StackLens has no accounts."
      footer={
        <>
          <SavedNote show={saved} />
          <Button
            disabled={!dirty || !p.name.trim()}
            onClick={() => {
              update({ profile: { ...p, name: p.name.trim() } });
              flash();
            }}
          >
            Save profile
          </Button>
        </>
      }
    >
      <div className="flex items-center gap-4">
        <span className="grid size-14 place-items-center rounded-full bg-gradient-to-br from-brand/80 to-violet-500/80 text-lg font-semibold text-white">
          {initials(p.name)}
        </span>
        <div className="text-xs text-muted-foreground">Your avatar uses your initials.</div>
      </div>
      <Field label="Display name">
        <Input value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} maxLength={60} />
      </Field>
      <Field label="Email" hint="Optional">
        <Input type="email" value={p.email} onChange={(e) => setP({ ...p, email: e.target.value })} placeholder="you@company.com" />
      </Field>
      <Field label="Role">
        <Select value={p.role} onChange={(e) => setP({ ...p, role: e.target.value })} className="w-56">
          {['Developer', 'SRE / On-call', 'Engineering manager', 'QA', 'Support'].map((r) => (
            <option key={r}>{r}</option>
          ))}
        </Select>
      </Field>
    </Section>
  );
}

function AppearanceTab() {
  const [previewAt] = useState(() => Date.now());
  const { theme, setTheme } = useTheme();
  const { settings, update } = useSettings();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const themes = [
    { v: 'light', label: 'Light', icon: Sun, preview: 'bg-white border-zinc-200', bar: 'bg-zinc-200' },
    { v: 'dark', label: 'Dark', icon: Moon, preview: 'bg-zinc-900 border-zinc-700', bar: 'bg-zinc-700' },
    { v: 'system', label: 'System', icon: Monitor, preview: 'bg-gradient-to-r from-white to-zinc-900 border-zinc-400', bar: 'bg-zinc-400' },
  ];
  return (
    <Section title="Appearance" description="Theme and defaults for the dashboard.">
      <Field label="Theme">
        <div className="grid max-w-md grid-cols-3 gap-3">
          {themes.map((t) => (
            <button
              key={t.v}
              onClick={() => setTheme(t.v)}
              className={cn(
                'rounded-lg border p-2 text-left transition-all cursor-pointer hover:border-foreground/30',
                mounted && theme === t.v && 'border-brand ring-2 ring-brand/30',
              )}
            >
              <div className={cn('mb-2 h-14 rounded-md border p-1.5', t.preview)}>
                <div className={cn('mb-1 h-1.5 w-8 rounded', t.bar)} />
                <div className={cn('h-1.5 w-12 rounded', t.bar)} />
              </div>
              <div className="flex items-center gap-1.5 text-xs font-medium">
                <t.icon className="size-3.5" /> {t.label}
              </div>
            </button>
          ))}
        </div>
      </Field>
      <Field label="Time format" hint="How timestamps appear in tables and trace details">
        <div className="flex items-center gap-3">
          <Select value={settings.timeFormat} onChange={(e) => update({ timeFormat: e.target.value as '12h' | '24h' })} className="w-48">
            <option value="12h">12-hour (7:37:16 PM)</option>
            <option value="24h">24-hour (19:37:16)</option>
          </Select>
          <span className="font-mono text-xs text-muted-foreground">{formatDateTime(previewAt, settings.timeFormat)}</span>
        </div>
      </Field>
      <Field label="Default time range" hint="Used when a page opens without a range">
        <Select value={settings.defaultRange} onChange={(e) => update({ defaultRange: e.target.value })} className="w-48">
          {[
            ['15m', 'Last 15 minutes'],
            ['1h', 'Last hour'],
            ['3h', 'Last 3 hours'],
            ['12h', 'Last 12 hours'],
            ['1d', 'Last day'],
            ['1w', 'Last week'],
          ].map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </Select>
      </Field>
    </Section>
  );
}

function ThresholdsTab() {
  const { settings, update } = useSettings();
  const [t, setT] = useState(settings.thresholds);
  const [saved, flash] = useSaved();
  useEffect(() => setT(settings.thresholds), [settings.thresholds]);
  const valid = t.errorWarn < t.errorBad && t.p95Warn < t.p95Bad && t.errorWarn > 0 && t.p95Warn > 0;
  const dirty = JSON.stringify(t) !== JSON.stringify(settings.thresholds);
  const pct = (v: number) => +(v * 100).toFixed(2);
  return (
    <Section
      title="Health thresholds"
      description="When a KPI on the Overview crosses these values its card turns amber (warning) or red (critical)."
      footer={
        <>
          <SavedNote show={saved} />
          <Button variant="ghost" onClick={() => setT(DEFAULT_SETTINGS.thresholds)}>
            <RotateCcw /> Defaults
          </Button>
          <Button
            disabled={!dirty || !valid}
            onClick={() => {
              update({ thresholds: t });
              flash();
            }}
          >
            Save thresholds
          </Button>
        </>
      }
    >
      <Field label="Error rate" hint="Share of requests that fail with 5xx">
        <div className="flex flex-wrap items-center gap-3">
          <ThresholdInput
            tone="amber"
            label="Warning at"
            value={pct(t.errorWarn)}
            unit="%"
            onChange={(v) => setT({ ...t, errorWarn: v / 100 })}
          />
          <ThresholdInput
            tone="rose"
            label="Critical at"
            value={pct(t.errorBad)}
            unit="%"
            onChange={(v) => setT({ ...t, errorBad: v / 100 })}
          />
        </div>
      </Field>
      <Field label="p95 latency" hint="95th percentile request duration">
        <div className="flex flex-wrap items-center gap-3">
          <ThresholdInput tone="amber" label="Warning at" value={t.p95Warn} unit="ms" onChange={(v) => setT({ ...t, p95Warn: v })} />
          <ThresholdInput tone="rose" label="Critical at" value={t.p95Bad} unit="ms" onChange={(v) => setT({ ...t, p95Bad: v })} />
        </div>
      </Field>
      {!valid && <div className="text-xs text-rose-600 dark:text-rose-400">Warning must be greater than 0 and lower than critical.</div>}
      <div className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
        Preview: an error rate of {pct(t.errorWarn)}% shows <span className="font-medium text-amber-600 dark:text-amber-400">Elevated</span>
        , {pct(t.errorBad)}% shows <span className="font-medium text-rose-600 dark:text-rose-400">Critical</span>; p95 above{' '}
        {formatMs(t.p95Warn)} is <span className="font-medium text-amber-600 dark:text-amber-400">Degraded</span>, above{' '}
        {formatMs(t.p95Bad)} is <span className="font-medium text-rose-600 dark:text-rose-400">Slow</span>.
      </div>
    </Section>
  );
}

function ThresholdInput({
  label,
  value,
  unit,
  onChange,
  tone,
}: {
  label: string;
  value: number;
  unit: string;
  onChange: (v: number) => void;
  tone: 'amber' | 'rose';
}) {
  return (
    <label
      className={cn('flex items-center gap-2 rounded-md border px-2 py-1', tone === 'amber' ? 'border-amber-400/40' : 'border-rose-400/40')}
    >
      <span className={cn('size-2 rounded-full', tone === 'amber' ? 'bg-amber-400' : 'bg-rose-400')} />
      <span className="text-xs text-muted-foreground">{label}</span>
      <input
        type="number"
        min={0}
        step="any"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-20 bg-transparent text-right font-mono text-sm outline-none"
      />
      <span className="text-xs text-muted-foreground">{unit}</span>
    </label>
  );
}

interface ServerInfo {
  storage: {
    database: { kind: 'postgres' | 'embedded'; location: string };
    dataDir: string;
    traces: number;
    errorTraces: number;
    summaries: number;
    oldest?: number;
    retentionDays: number;
    limits: { traces: number; errorTraces: number; summaries: number };
    bytes: number;
  };
  incidents: IncidentSource;
}

const mb = (b: number) => (b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${(b / 1e3).toFixed(0)} KB`);

function Meter({ label, value, max, hint }: { label: string; value: number; max: number; hint?: string }) {
  const p = Math.min(100, (value / Math.max(max, 1)) * 100);
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span>{label}</span>
        <span className="font-mono text-muted-foreground">
          {value.toLocaleString()} / {max.toLocaleString()}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div className={cn('h-full rounded-full transition-all', p > 90 ? 'bg-amber-400' : 'bg-brand')} style={{ width: `${p}%` }} />
      </div>
      {hint && <div className="mt-1 text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

function DataTab({ info, reload }: { info: ServerInfo | null; reload: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const s = info?.storage;
  return (
    <div className="space-y-4">
      <Section title="Storage" description="Traces, summaries, incidents and settings are stored in PostgreSQL.">
        {s ? (
          <>
            <Meter
              label="Full call trees (healthy)"
              value={s.traces - s.errorTraces}
              max={s.limits.traces}
              hint="Older call trees keep their summary; the full tree is pruned first."
            />
            <Meter
              label="Call trees with errors"
              value={s.errorTraces}
              max={s.limits.errorTraces}
              hint="Kept in a separate pool so failing requests stay inspectable longer."
            />
            <Meter
              label="Request summaries"
              value={s.summaries}
              max={s.limits.summaries}
              hint="Power charts, metrics and error groups for long time ranges."
            />
            <div className="grid gap-3 border-t pt-4 text-xs sm:grid-cols-4">
              <div>
                <div className="text-muted-foreground">Database</div>
                <div className="font-mono">{s.database.kind === 'postgres' ? 'PostgreSQL' : 'Embedded PostgreSQL'}</div>
                <div className="break-all font-mono text-muted-foreground">{s.database.location}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Table size</div>
                <div className="font-mono">{mb(s.bytes)}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Retention</div>
                <div className="font-mono">{s.retentionDays} days</div>
              </div>
              <div>
                <div className="text-muted-foreground">Oldest data</div>
                <div className="font-mono">{s.oldest ? new Date(s.oldest).toLocaleString() : '—'}</div>
              </div>
            </div>
            <div className="text-[11px] text-muted-foreground">
              Set <code className="font-mono">DATABASE_URL</code> to use an external PostgreSQL server. Limits:{' '}
              <code className="font-mono">STACKLENS_MAX_TRACES</code>, <code className="font-mono">STACKLENS_MAX_ERROR_TRACES</code>,{' '}
              <code className="font-mono">STACKLENS_MAX_SUMMARIES</code>, <code className="font-mono">STACKLENS_RETENTION_DAYS</code>.
            </div>
          </>
        ) : (
          <div className="h-24 animate-pulse rounded-md bg-muted" />
        )}
      </Section>
      <Section title="Danger zone" description="Permanently delete every captured trace and summary. Incidents are not affected.">
        <div className="flex items-center justify-between gap-4">
          <div className="text-xs text-muted-foreground">
            {confirming ? 'This cannot be undone. Delete all trace data?' : 'Useful before a demo or after changing instrumentation.'}
          </div>
          {confirming ? (
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={async () => {
                  await fetch('/api/traces', { method: 'DELETE' });
                  setConfirming(false);
                  reload();
                }}
              >
                <Trash2 /> Delete all data
              </Button>
            </div>
          ) : (
            <Button
              variant="outline"
              className="border-rose-400/40 text-rose-600 hover:bg-rose-500/10 dark:text-rose-400"
              onClick={() => setConfirming(true)}
            >
              <Trash2 /> Clear trace data
            </Button>
          )}
        </div>
      </Section>
    </div>
  );
}

function IntegrationsTab({ info }: { info: ServerInfo | null }) {
  const src = info?.incidents;
  return (
    <div className="space-y-4">
      <Section title="ServiceNow" description="Create and track incidents for error groups.">
        <div className="flex items-start gap-3">
          <div
            className={cn(
              'mt-0.5 size-2.5 shrink-0 rounded-full',
              src?.mode === 'servicenow' ? (src.error ? 'bg-rose-400' : 'bg-success') : 'bg-muted-foreground/40',
            )}
          />
          <div className="text-sm">
            {src?.mode === 'servicenow' ? (
              <>
                Connected to <span className="font-mono">{src.instance?.replace(/^https?:\/\//, '')}</span>
                {src.error && <div className="text-xs text-rose-600 dark:text-rose-400">{src.error}</div>}
              </>
            ) : (
              <>
                <div className="font-medium">Not connected · demo mode</div>
                <div className="mt-1 text-xs text-muted-foreground">Incidents are stored locally in the data folder.</div>
              </>
            )}
          </div>
        </div>
        <div className="rounded-md bg-muted/50 p-3 text-xs leading-relaxed text-muted-foreground">
          To connect, copy <code className="font-mono">apps/dashboard/.env.example</code> to <code className="font-mono">.env.local</code>,
          set <code className="font-mono">SERVICENOW_INSTANCE</code> and either <code className="font-mono">SERVICENOW_USERNAME</code>/
          <code className="font-mono">SERVICENOW_PASSWORD</code> or <code className="font-mono">SERVICENOW_TOKEN</code>, then restart the
          dashboard. Credentials stay on the server and are never sent to the browser.
        </div>
      </Section>
      <Section title="Collector" description="Where your instrumented apps send traces.">
        <Field label="Ingest endpoint">
          <code className="rounded-md border bg-muted/40 px-2 py-1 font-mono text-xs">
            {typeof window !== 'undefined' ? window.location.origin : ''}/api/ingest
          </code>
        </Field>
        <Field label="Tracer config" hint="Set in your app">
          <code className="font-mono text-xs text-muted-foreground">STACKLENS_ENDPOINT=…/api/ingest</code>
        </Field>
      </Section>
    </div>
  );
}

const SHORTCUTS: [string[], string][] = [
  [['⌘', 'B'], 'Collapse / expand the sidebar'],
  [['⌘', ','], 'Open settings'],
  [['?'], 'Open keyboard shortcuts'],
  [['↑', '↓'], 'Move between calls in the call tree'],
  [['←', '→'], 'Collapse / expand a call'],
  [['Esc'], 'Close the call inspector'],
  [['Drag'], 'Zoom any time chart to a window'],
];

function ShortcutsTab() {
  return (
    <Section title="Keyboard shortcuts" description="Ctrl replaces ⌘ on Windows and Linux.">
      <div className="divide-y">
        {SHORTCUTS.map(([keys, label]) => (
          <div key={label} className="flex items-center justify-between py-2.5 text-sm">
            <span>{label}</span>
            <span className="flex gap-1">
              {keys.map((k) => (
                <kbd key={k} className="min-w-6 rounded-md border bg-muted px-1.5 py-0.5 text-center font-mono text-[11px] shadow-xs">
                  {k}
                </kbd>
              ))}
            </span>
          </div>
        ))}
      </div>
    </Section>
  );
}

function SettingsInner() {
  const sp = useSearchParams();
  const router = useRouter();
  const tab = (TABS.find((t) => t.id === sp.get('tab'))?.id ?? 'profile') as TabId;
  const [info, setInfo] = useState<ServerInfo | null>(null);
  const load = () =>
    fetch('/api/settings', { cache: 'no-store' })
      .then((r) => r.json())
      .then(setInfo)
      .catch(() => {});
  useEffect(() => {
    load();
  }, []);

  return (
    <>
      <PageHeader title="Settings" description="Your profile and dashboard preferences" />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-5xl flex-col gap-6 p-6 md:flex-row">
          <nav className="flex shrink-0 gap-1 overflow-x-auto md:w-52 md:flex-col">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => router.replace(`/settings?tab=${t.id}`, { scroll: false })}
                className={cn(
                  'flex h-9 items-center gap-2.5 whitespace-nowrap rounded-md px-3 text-sm text-muted-foreground transition-colors cursor-pointer hover:bg-accent hover:text-foreground',
                  tab === t.id && 'bg-accent font-medium text-foreground',
                )}
              >
                <t.icon className={cn('size-4', tab === t.id && 'text-brand')} />
                {t.label}
              </button>
            ))}
          </nav>
          <div className="min-w-0 flex-1">
            {tab === 'profile' && <ProfileTab />}
            {tab === 'appearance' && <AppearanceTab />}
            {tab === 'thresholds' && <ThresholdsTab />}
            {tab === 'data' && <DataTab info={info} reload={load} />}
            {tab === 'integrations' && <IntegrationsTab info={info} />}
            {tab === 'shortcuts' && <ShortcutsTab />}
          </div>
        </div>
      </div>
    </>
  );
}

export default function SettingsPage() {
  return (
    <Suspense>
      <SettingsInner />
    </Suspense>
  );
}
