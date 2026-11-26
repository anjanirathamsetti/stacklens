'use client';
import { useEffect, useState } from 'react';
import { Loader2, Siren } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { DraftWithAiButton } from '@/features/ai/components/ai-entry-points';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { PriorityBadge } from '@/features/incidents/components/incident-badges';
import type { Incident, IncidentSource } from '@/lib/api-types';

const LEVELS = [
  ['1', '1 - High'],
  ['2', '2 - Medium'],
  ['3', '3 - Low'],
];
const PRIORITY_LABEL: Record<number, string> = { 1: 'Critical', 2: 'High', 3: 'Moderate', 4: 'Low', 5: 'Planning' };
const priorityOf = (u: number, i: number) => {
  const s = u + i;
  return s <= 2 ? 1 : s === 3 ? 2 : s === 4 ? 3 : s === 5 ? 4 : 5;
};

/** Opens a pre-filled ServiceNow incident form for one error group. */
export function CreateIncidentDialog({
  errorId,
  open,
  onOpenChange,
  onCreated,
  source,
}: {
  errorId: string | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: (i: Incident) => void;
  source?: IncidentSource;
}) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [short, setShort] = useState('');
  const [desc, setDesc] = useState('');
  const [urgency, setUrgency] = useState(2);
  const [impact, setImpact] = useState(2);
  const [group, setGroup] = useState('');

  useEffect(() => {
    if (!open || !errorId) return;
    setLoading(true);
    setErr(null);
    fetch(`/api/incidents/draft?errorId=${errorId}`)
      .then(async (r) => (r.ok ? r.json() : Promise.reject(new Error((await r.json()).error))))
      .then((d) => {
        setShort(d.shortDescription);
        setDesc(d.description);
        setUrgency(d.urgency);
        setImpact(d.impact);
      })
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  }, [open, errorId]);

  const submit = async () => {
    setSaving(true);
    setErr(null);
    try {
      const r = await fetch('/api/incidents', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ errorId, shortDescription: short, description: desc, urgency, impact, assignmentGroup: group || undefined }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      onCreated(d.incident);
      onOpenChange(false);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const p = priorityOf(urgency, impact);
  const demo = source?.mode !== 'servicenow';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <div className="mb-4 flex items-start gap-3 pr-8">
          <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand/10 text-brand">
            <Siren className="size-4.5" />
          </div>
          <div>
            <DialogTitle>Create incident</DialogTitle>
            <DialogDescription>
              {demo
                ? 'Demo mode: the ticket is stored locally, not sent to ServiceNow.'
                : `Opens a ticket in ${source?.instance?.replace(/^https?:\/\//, '')} tagged to this error group.`}
            </DialogDescription>
          </div>
        </div>
        {loading ? (
          <div className="grid h-48 place-items-center">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-3.5">
            <label className="block space-y-1.5">
              <span className="text-xs font-medium">Short description</span>
              <Input value={short} maxLength={160} onChange={(e) => setShort(e.target.value)} />
            </label>
            <label className="block space-y-1.5">
              <span className="flex items-center justify-between text-xs font-medium">
                Description
                <DraftWithAiButton />
              </span>
              <textarea
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                rows={10}
                className="w-full rounded-md border border-input bg-card px-2.5 py-2 font-mono text-[11px] leading-relaxed shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              />
            </label>
            <div className="grid grid-cols-3 gap-3">
              <label className="block space-y-1.5">
                <span className="text-xs font-medium">Urgency</span>
                <Select value={String(urgency)} onChange={(e) => setUrgency(Number(e.target.value))} className="w-full">
                  {LEVELS.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="block space-y-1.5">
                <span className="text-xs font-medium">Impact</span>
                <Select value={String(impact)} onChange={(e) => setImpact(Number(e.target.value))} className="w-full">
                  {LEVELS.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </Select>
              </label>
              <div className="space-y-1.5">
                <span className="text-xs font-medium">Priority</span>
                <div className="flex h-8 items-center">
                  <PriorityBadge code={p} label={`${p} - ${PRIORITY_LABEL[p]}`} />
                </div>
              </div>
            </div>
            <label className="block space-y-1.5">
              <span className="text-xs font-medium">
                Assignment group <span className="font-normal text-muted-foreground">(optional)</span>
              </span>
              <Input value={group} placeholder="e.g. Payments Platform" onChange={(e) => setGroup(e.target.value)} />
            </label>
            {err && (
              <div className="rounded-md border border-rose-400/30 bg-rose-500/[0.06] px-3 py-2 text-xs text-rose-700 dark:text-rose-300">
                {err}
              </div>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={submit} disabled={saving || !short.trim() || !errorId}>
                {saving ? <Loader2 className="animate-spin" /> : <Siren />}
                Create incident
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
