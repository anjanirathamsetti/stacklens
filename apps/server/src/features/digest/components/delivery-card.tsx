'use client';
import { useEffect, useMemo, useState } from 'react';
import { Eye, EyeOff, Loader2, Mail, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/toast';
import { useFacets } from '@/components/layout/filter-bar';
import { sendJson, setCached, useResource } from '@/lib/use-resource';
import { DEFAULT_DIGEST } from '@/lib/config-defaults';
import { timeAgo } from '@/lib/utils';
import type { DigestConfig } from '@/lib/api-types';

const URL_ = '/api/config/digest';

function zones(): string[] {
  try {
    return (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf('timeZone');
  } catch {
    return ['UTC'];
  }
}

const hourLabel = (h: number) => `${h % 12 || 12}:00 ${h < 12 ? 'AM' : 'PM'}`;

/** Where and when the digest is sent (Slack or any JSON webhook). */
export function DeliveryCard() {
  const { data } = useResource<{ config: DigestConfig; publicUrl: string | null; canEdit?: boolean }>(URL_);
  const canEdit = data?.canEdit ?? false;
  const facets = useFacets();
  const [cfg, setCfg] = useState<DigestConfig>(DEFAULT_DIGEST);
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState<'save' | 'test' | null>(null);
  const tzs = useMemo(() => zones(), []);

  useEffect(() => {
    if (!data) return;
    const c = data.config;
    setCfg(c.timezone === 'UTC' && !c.webhookUrl ? { ...c, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' } : c);
  }, [data]);

  const dirty =
    data && JSON.stringify({ ...data.config, lastSentAt: 0, lastError: 0 }) !== JSON.stringify({ ...cfg, lastSentAt: 0, lastError: 0 });
  const set = (p: Partial<DigestConfig>) => setCfg((c) => ({ ...c, ...p }));

  const save = async () => {
    setBusy('save');
    try {
      const r = await sendJson<{ config: DigestConfig; publicUrl: string | null }>(URL_, 'PUT', { config: cfg });
      setCached(URL_, r);
      toast(cfg.enabled ? `Digest scheduled daily at ${hourLabel(cfg.hour)}` : 'Delivery settings saved');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  };

  const test = async () => {
    setBusy('test');
    try {
      if (dirty) setCached(URL_, await sendJson(URL_, 'PUT', { config: cfg }));
      await sendJson('/api/digest/send', 'POST');
      toast('Test digest sent');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(null);
      const r = await fetch(URL_).then((x) => x.json());
      setCached(URL_, r);
    }
  };

  return (
    <Card className="overflow-hidden">
      <div className="flex items-start justify-between gap-3 border-b px-4 py-3">
        <div>
          <div className="text-sm font-semibold">Delivery</div>
          <div className="text-xs text-muted-foreground">Post this digest to Slack every day</div>
        </div>
        <Switch checked={cfg.enabled} onCheckedChange={(enabled) => set({ enabled })} aria-label="Send daily" disabled={!canEdit} />
      </div>
      {!canEdit && data && (
        <div className="border-b bg-muted/40 px-4 py-2 text-xs text-muted-foreground">Only admins can change delivery.</div>
      )}
      <fieldset disabled={!canEdit} className="space-y-3 p-4 disabled:opacity-70">
        <label className="block space-y-1.5">
          <span className="text-xs font-medium">Webhook URL</span>
          <div className="relative">
            <Input
              type={reveal ? 'text' : 'password'}
              value={cfg.webhookUrl}
              placeholder="https://hooks.slack.com/services/…"
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => set({ webhookUrl: e.target.value.trim() })}
              className="pr-8 font-mono text-xs"
            />
            <button
              type="button"
              onClick={() => setReveal(!reveal)}
              className="absolute right-1.5 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded text-muted-foreground hover:text-foreground cursor-pointer"
              aria-label={reveal ? 'Hide URL' : 'Show URL'}
            >
              {reveal ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
            </button>
          </div>
          <span className="block text-[11px] text-muted-foreground">A Slack incoming webhook, or any URL that accepts a JSON POST.</span>
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block space-y-1.5">
            <span className="text-xs font-medium">Send at</span>
            <Select value={String(cfg.hour)} onChange={(e) => set({ hour: Number(e.target.value) })} className="w-full">
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {hourLabel(h)}
                </option>
              ))}
            </Select>
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium">Format</span>
            <Select value={cfg.format} onChange={(e) => set({ format: e.target.value as DigestConfig['format'] })} className="w-full">
              <option value="slack">Slack message</option>
              <option value="json">Raw JSON</option>
            </Select>
          </label>
        </div>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium">Time zone</span>
          <Select value={cfg.timezone} onChange={(e) => set({ timezone: e.target.value })} className="w-full" searchable>
            {tzs.map((z) => (
              <option key={z} value={z}>
                {z.replace(/_/g, ' ')}
              </option>
            ))}
          </Select>
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium">Project</span>
          <Select value={cfg.project} onChange={(e) => set({ project: e.target.value })} className="w-full">
            <option value="">All projects</option>
            {(facets?.projects ?? []).map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </Select>
        </label>
        <div className="text-[11px] text-muted-foreground">
          {data?.config.lastError ? (
            <span className="text-destructive">Last attempt failed: {data.config.lastError}</span>
          ) : data?.config.lastSentAt ? (
            <>Last sent {timeAgo(data.config.lastSentAt)}</>
          ) : (
            <>Not sent yet</>
          )}
          {!data?.publicUrl && (
            <div className="mt-1">
              Set <code className="font-mono">STACKLENS_PUBLIC_URL</code> to include a link back to StackLens.
            </div>
          )}
        </div>
      </fieldset>
      {canEdit && (
        <div className="flex items-center justify-between gap-2 border-t bg-muted/30 px-4 py-2.5">
          <Button variant="ghost" size="sm" onClick={test} disabled={!cfg.webhookUrl || !!busy}>
            {busy === 'test' ? <Loader2 className="animate-spin" /> : <Send />} Send test
          </Button>
          <Button size="sm" onClick={save} disabled={!dirty || !!busy}>
            {busy === 'save' && <Loader2 className="animate-spin" />} Save
          </Button>
        </div>
      )}
      <div className="flex items-center gap-2 border-t px-4 py-2.5 text-[11px] text-muted-foreground">
        <Mail className="size-3.5" /> Email delivery is planned; use a webhook for now.
      </div>
    </Card>
  );
}
