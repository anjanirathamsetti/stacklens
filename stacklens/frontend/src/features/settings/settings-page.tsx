'use client';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTheme } from 'next-themes';
import { Gauge, KeyRound, Keyboard, Monitor, Moon, Palette, RotateCcw, Sun, User } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { DEFAULT_SETTINGS, initials, useSettings } from '@/lib/settings-context';
import { Field, SavedNote, Section, useSaved } from '@/components/layout/settings-ui';
import { cn, formatDateTime, formatMs } from '@/lib/utils';
import type { AuthUser } from '@stacklens/shared/api-types';
import { ROLE_LABELS, useCurrentUser } from '@/lib/current-user';
import { sendJson } from '@/lib/use-resource';

const TABS = [
  { id: 'profile', label: 'Profile', icon: User },
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'thresholds', label: 'Health thresholds', icon: Gauge },
  { id: 'shortcuts', label: 'Keyboard shortcuts', icon: Keyboard },
] as const;
type TabId = (typeof TABS)[number]['id'];

function ProfileTab() {
  const { user, setUser } = useCurrentUser();
  const [p, setP] = useState({ name: user.name, email: user.email });
  const [saved, flash] = useSaved();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const dirty = p.name !== user.name || p.email !== user.email;

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const r = await sendJson<{ user: AuthUser }>('/api/auth/profile', 'PATCH', { name: p.name.trim(), email: p.email.trim() });
      setUser(r.user);
      flash();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <Section
        title="Profile"
        description="Your name appears in the sidebar, on saved views and as the author of incident work notes."
        footer={
          <>
            <SavedNote show={saved} />
            {error && <span className="mr-auto text-xs text-destructive">{error}</span>}
            <Button disabled={!dirty || !p.name.trim() || busy} onClick={save}>
              Save profile
            </Button>
          </>
        }
      >
        <div className="flex items-center gap-4">
          <span className="grid size-14 place-items-center rounded-full bg-gradient-to-br from-viz/80 to-violet-500/80 text-lg font-semibold text-white">
            {initials(p.name || user.name)}
          </span>
          <div className="text-xs text-muted-foreground">Your avatar uses your initials.</div>
        </div>
        <Field label="Name">
          <Input value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} maxLength={80} />
        </Field>
        <Field label="Email" hint="Used to sign in">
          <Input type="email" value={p.email} onChange={(e) => setP({ ...p, email: e.target.value })} />
        </Field>
        <Field label="Role" hint="Set by an admin">
          <div className="flex items-center gap-2">
            <Badge tone={user.role === 'admin' ? 'brand' : 'neutral'}>{ROLE_LABELS[user.role].label}</Badge>
            <span className="text-xs text-muted-foreground">{ROLE_LABELS[user.role].description}</span>
          </div>
        </Field>
      </Section>
      <PasswordSection />
    </div>
  );
}

function PasswordSection() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [saved, flash] = useSaved();
  const [busy, setBusy] = useState(false);
  const mismatch = !!confirm && next !== confirm;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mismatch) return;
    setBusy(true);
    setError('');
    try {
      await sendJson('/api/auth/password', 'POST', { current, next });
      setCurrent('');
      setNext('');
      setConfirm('');
      flash();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit}>
      <Section
        title="Password"
        description="Changing your password signs you out on every other device."
        footer={
          <>
            <SavedNote show={saved} />
            {error && <span className="mr-auto text-xs text-destructive">{error}</span>}
            <Button type="submit" disabled={!current || !next || mismatch || busy}>
              <KeyRound /> Change password
            </Button>
          </>
        }
      >
        <Field label="Current password">
          <Input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </Field>
        <Field label="New password">
          <Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
        </Field>
        <Field label="Confirm new password">
          <Input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          {mismatch && <div className="mt-1 text-xs text-destructive">Passwords don’t match</div>}
        </Field>
      </Section>
    </form>
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
  return (
    <>
      <PageHeader title="Settings" description="Your account and personal preferences" />
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
