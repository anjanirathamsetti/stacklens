'use client';
import { useState } from 'react';
import { AlertTriangle, KeyRound, Plus, ShieldCheck } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { toast } from '@/components/ui/toast';
import { CopyButton } from '@/components/data-display/json-view';
import { sendJson, setCached, useResource } from '@/lib/use-resource';
import { cn, timeAgo } from '@/lib/utils';
import type { ApiKeyInfo, SecurityConfig } from '@stacklens/shared/api-types';

const KEYS = '/api/admin/api-keys';
const SECURITY = '/api/config/security';

function CreateKeyDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (v: boolean) => void; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [key, setKey] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const close = (v: boolean) => {
    onOpenChange(v);
    if (!v) {
      setKey(null);
      setName('');
      setError('');
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await sendJson<{ key: string }>(KEYS, 'POST', { name });
      setKey(r.key);
      onCreated();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const snippet = key ? `STACKLENS_API_KEY=${key}` : '';

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="w-[min(520px,calc(100vw-32px))]">
        <div className="mb-4 flex items-start gap-3 pr-8">
          <div
            className={cn(
              'grid size-9 shrink-0 place-items-center rounded-lg',
              key ? 'bg-success/12 text-success' : 'bg-brand/10 text-brand',
            )}
          >
            {key ? <ShieldCheck className="size-4.5" /> : <KeyRound className="size-4.5" />}
          </div>
          <div>
            <DialogTitle>{key ? 'Copy your API key' : 'New API key'}</DialogTitle>
            <DialogDescription>
              {key
                ? 'This is the only time the full key is shown. Store it in your app’s secrets.'
                : 'Instrumented apps send this key with every batch of traces.'}
            </DialogDescription>
          </div>
        </div>
        {key ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 rounded-lg border bg-muted/40 py-2 pl-3 pr-1.5">
              <code className="min-w-0 flex-1 break-all font-mono text-xs">{key}</code>
              <CopyButton text={key} />
            </div>
            <div className="text-xs text-muted-foreground">Add it to the app’s environment, then restart the app:</div>
            <div className="flex items-center gap-2 rounded-lg border bg-muted/40 py-2 pl-3 pr-1.5">
              <code className="min-w-0 flex-1 break-all font-mono text-xs">{snippet}</code>
              <CopyButton text={snippet} />
            </div>
            <div className="mt-2 flex justify-end">
              <Button onClick={() => close(false)}>Done</Button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3.5">
            <label className="block space-y-1.5">
              <span className="text-xs font-medium">Name</span>
              <Input
                autoFocus
                required
                maxLength={80}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. billing-api production"
              />
              <span className="block text-xs text-muted-foreground">
                Name it after the app or environment, so you know what breaks if you revoke it.
              </span>
            </label>
            {error && <div className="text-xs text-destructive">{error}</div>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => close(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                <KeyRound /> Create key
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function ApiKeysPage() {
  const { data, reload } = useResource<{ keys: ApiKeyInfo[] }>(KEYS);
  const { data: sec } = useResource<{ config: SecurityConfig }>(SECURITY);
  const [creating, setCreating] = useState(false);
  const keys = data?.keys ?? [];
  const active = keys.filter((k) => !k.revokedAt);
  const required = sec?.config.requireIngestKey ?? false;

  const setRequired = async (v: boolean) => {
    if (v && active.length === 0) return toast('Create a key and add it to your apps first', 'error');
    if (v && !window.confirm('Reject traces from apps that don’t send a valid key? Apps without a key stop appearing in StackLens.'))
      return;
    try {
      setCached(SECURITY, await sendJson(SECURITY, 'PUT', { config: { ...sec?.config, requireIngestKey: v } }));
      toast(v ? 'API key now required for incoming traces' : 'Traces accepted without a key');
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  const revoke = async (k: ApiKeyInfo) => {
    if (!window.confirm(`Revoke “${k.name}”? Apps using it will be rejected from their next batch. This can't be undone.`)) return;
    try {
      await sendJson(`${KEYS}/${k.id}`, 'DELETE');
      toast(`Revoked “${k.name}”`);
      void reload();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  return (
    <>
      <PageHeader title="API keys" description="Keys your instrumented apps use to send traces">
        <Button onClick={() => setCreating(true)}>
          <Plus /> New key
        </Button>
      </PageHeader>
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl space-y-4 p-6">
          <Card className={cn('flex items-start gap-4 p-4', !required && 'border-warning/40')}>
            <div
              className={cn(
                'grid size-9 shrink-0 place-items-center rounded-lg',
                required ? 'bg-success/12 text-success' : 'bg-warning/15 text-warning',
              )}
            >
              {required ? <ShieldCheck className="size-4.5" /> : <AlertTriangle className="size-4.5" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold">Require an API key for incoming traces</div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {required
                  ? 'Only apps that send a valid key can send traces.'
                  : 'Off: anyone who can reach this server can send traces. Turn this on once your apps send a key.'}
              </div>
            </div>
            <Switch checked={required} onCheckedChange={setRequired} aria-label="Require API key" />
          </Card>

          <Card className="overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                  <th className="h-9 pl-4 font-medium">Name</th>
                  <th className="h-9 px-3 font-medium">Key</th>
                  <th className="h-9 px-3 font-medium">Created</th>
                  <th className="h-9 px-3 font-medium">Last used</th>
                  <th className="h-9 pr-4" />
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => (
                  <tr key={k.id} className={cn('border-b last:border-0', k.revokedAt && 'text-muted-foreground')}>
                    <td className="py-2.5 pl-4">
                      <div className="font-medium">{k.name}</div>
                      {k.createdBy && <div className="text-xs text-muted-foreground">by {k.createdBy}</div>}
                    </td>
                    <td className="px-3 font-mono text-xs">{k.prefix}…</td>
                    <td className="px-3 text-xs">{timeAgo(k.createdAt)}</td>
                    <td className="px-3 text-xs">{k.lastUsedAt ? timeAgo(k.lastUsedAt) : 'Never'}</td>
                    <td className="pr-4 text-right">
                      {k.revokedAt ? (
                        <Badge tone="neutral">Revoked {timeAgo(k.revokedAt)}</Badge>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => void revoke(k)}
                        >
                          Revoke
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data && keys.length === 0 && (
              <div className="flex flex-col items-center px-6 py-12 text-center">
                <KeyRound className="mb-2 size-5 text-muted-foreground" />
                <div className="text-sm font-medium">No API keys yet</div>
                <div className="mt-1 max-w-sm text-xs text-muted-foreground">
                  Create one key per app or environment, so you can revoke one without touching the others.
                </div>
              </div>
            )}
          </Card>

          <Card className="p-4">
            <div className="text-sm font-semibold">Using a key</div>
            <p className="mt-1 text-xs text-muted-foreground">
              Set <code className="font-mono">STACKLENS_API_KEY</code> in the app’s environment, or pass it to the tracer:
            </p>
            <pre className="mt-2 overflow-x-auto rounded-md border bg-muted/40 p-3 font-mono text-[11.5px] leading-relaxed">
              {`stacklens.init({ application: 'billing-api', apiKey: process.env.STACKLENS_API_KEY });`}
            </pre>
          </Card>
        </div>
      </div>
      <CreateKeyDialog open={creating} onOpenChange={setCreating} onCreated={() => void reload()} />
    </>
  );
}
