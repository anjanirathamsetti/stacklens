'use client';
import { useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Bookmark, BookmarkPlus, Check, ChevronDown, Clock, Link2, Pin, RefreshCw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { copyWithToast, toast } from '@/components/ui/toast';
import { Tooltip } from '@/components/ui/tooltip';
import { describeQuery, normalizeQuery, PAGE_LABELS, patchView, removeView, saveView, useSavedViews } from '@/lib/saved-views';
import { resolveRange, useFilters } from '@/lib/url-filters';
import { useCan } from '@/lib/current-user';
import { cn } from '@/lib/utils';
import type { SavedView } from '@stacklens/shared/api-types';

/* -------------------------------- Views -------------------------------- */

function ViewRow({ v, active, onOpen }: { v: SavedView; active: boolean; onOpen: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const canWrite = useCan('member');
  return (
    <div
      className={cn('group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent', active && 'bg-brand/[0.07]')}
      onMouseLeave={() => setConfirm(false)}
    >
      <button onClick={onOpen} className="min-w-0 flex-1 text-left cursor-pointer">
        <div className="flex items-center gap-1.5 text-sm">
          <span className={cn('truncate', active && 'font-medium text-brand')}>{v.name}</span>
          {active && <Check className="size-3.5 shrink-0 text-brand" />}
        </div>
        <div className="truncate text-[11px] text-muted-foreground">
          {PAGE_LABELS[v.path] ?? v.path} · {describeQuery(v.query)}
        </div>
      </button>
      {canWrite && (
        <div className={cn('flex shrink-0 items-center gap-0.5', !confirm && !v.pinned && 'opacity-0 group-hover:opacity-100')}>
          {confirm ? (
            <Button
              size="sm"
              variant="destructive"
              className="h-6 px-2 text-[11px]"
              onClick={() => removeView(v.id).then(() => toast(`Deleted “${v.name}”`))}
            >
              Delete
            </Button>
          ) : (
            <>
              <Tooltip content={v.pinned ? 'Unpin from sidebar' : 'Pin to sidebar'}>
                <button
                  onClick={() => patchView(v.id, { pinned: !v.pinned })}
                  className={cn(
                    'grid size-6 place-items-center rounded text-muted-foreground hover:bg-background hover:text-foreground cursor-pointer',
                    v.pinned && 'text-brand',
                  )}
                  aria-label={v.pinned ? 'Unpin' : 'Pin'}
                >
                  <Pin className={cn('size-3.5', v.pinned && 'fill-current')} />
                </button>
              </Tooltip>
              <Tooltip content="Delete view">
                <button
                  onClick={() => setConfirm(true)}
                  className="grid size-6 place-items-center rounded text-muted-foreground opacity-0 hover:bg-background hover:text-destructive group-hover:opacity-100 cursor-pointer"
                  aria-label="Delete"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </Tooltip>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function SaveViewDialog({ open, onOpenChange, query }: { open: boolean; onOpenChange: (v: boolean) => void; query: string }) {
  const pathname = usePathname();
  const suggestion = describeQuery(query);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [pinned, setPinned] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const v = await saveView({
        name: name.trim() || `${PAGE_LABELS[pathname] ?? 'View'} · ${suggestion}`,
        path: pathname,
        query,
        description,
        pinned,
      });
      toast(`Saved “${v.name}”`);
      onOpenChange(false);
      setName('');
      setDescription('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(460px,calc(100vw-32px))]">
        <form onSubmit={submit}>
          <div className="mb-4 flex items-start gap-3 pr-8">
            <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand/10 text-brand">
              <BookmarkPlus className="size-4.5" />
            </div>
            <div>
              <DialogTitle>Save view</DialogTitle>
              <DialogDescription>Saved views are shared with everyone using this StackLens server.</DialogDescription>
            </div>
          </div>
          <div className="space-y-3.5">
            <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs">
              <span className="font-medium">{PAGE_LABELS[pathname] ?? pathname}</span>
              <span className="text-muted-foreground"> · {suggestion}</span>
            </div>
            <label className="block space-y-1.5">
              <span className="text-xs font-medium">Name</span>
              <Input
                autoFocus
                value={name}
                maxLength={80}
                placeholder={`e.g. Checkout errors (${suggestion})`}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-medium">
                Description <span className="font-normal text-muted-foreground">(optional)</span>
              </span>
              <Textarea rows={2} maxLength={280} value={description} onChange={(e) => setDescription(e.target.value)} />
            </label>
            <label className="flex items-center justify-between gap-3 rounded-md border px-3 py-2.5">
              <span>
                <span className="block text-sm font-medium">Pin to sidebar</span>
                <span className="block text-xs text-muted-foreground">One click away for the whole team</span>
              </span>
              <Switch checked={pinned} onCheckedChange={setPinned} aria-label="Pin to sidebar" />
            </label>
            {error && <div className="text-xs text-destructive">{error}</div>}
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              <Bookmark /> Save view
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** "Views" button in the filter bar: open, pin, delete and save named filter presets. */
export function ViewsMenu() {
  const canWrite = useCan('member');
  const pathname = usePathname();
  const router = useRouter();
  const { sp } = useFilters();
  const { views } = useSavedViews();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const current = normalizeQuery(sp.toString());
  const active = views.find((v) => v.path === pathname && normalizeQuery(v.query) === current);
  const here = views.filter((v) => v.path === pathname);
  const elsewhere = views.filter((v) => v.path !== pathname);
  const rawQuery = useMemo(() => {
    const p = new URLSearchParams(sp.toString());
    for (const k of ['page', 'selected', 'trace', 'view']) p.delete(k);
    return p.toString();
  }, [sp]);

  const openView = (v: SavedView) => {
    setOpen(false);
    router.push(v.query ? `${v.path}?${v.query}` : v.path);
  };

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" className={cn('max-w-52', active && 'border-brand/40 bg-brand/[0.05]')}>
            <Bookmark className={cn(active && 'fill-brand/20 text-brand')} />
            <span className="truncate">{active ? active.name : 'Views'}</span>
            <ChevronDown className="text-muted-foreground" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 p-1">
          {views.length === 0 ? (
            <div className="px-3 py-5 text-center">
              <Bookmark className="mx-auto mb-2 size-5 text-muted-foreground" />
              <div className="text-sm font-medium">No saved views yet</div>
              <div className="mt-1 text-xs text-muted-foreground">Save the filters you use often and share them with your team.</div>
            </div>
          ) : (
            <div className="max-h-80 overflow-y-auto">
              {here.length > 0 && (
                <>
                  <div className="px-2 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">This page</div>
                  {here.map((v) => (
                    <ViewRow key={v.id} v={v} active={v.id === active?.id} onOpen={() => openView(v)} />
                  ))}
                </>
              )}
              {elsewhere.length > 0 && (
                <>
                  <div className="px-2 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Other pages</div>
                  {elsewhere.map((v) => (
                    <ViewRow key={v.id} v={v} active={false} onOpen={() => openView(v)} />
                  ))}
                </>
              )}
            </div>
          )}
          {canWrite && (
            <div className="mt-1 space-y-0.5 border-t pt-1">
              {active && normalizeQuery(active.query) !== current && (
                <button
                  onClick={() => patchView(active.id, { query: rawQuery }).then(() => toast(`Updated “${active.name}”`))}
                  className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-sm hover:bg-accent cursor-pointer"
                >
                  <RefreshCw className="size-4 text-muted-foreground" /> Update “{active.name}”
                </button>
              )}
              <button
                onClick={() => {
                  setOpen(false);
                  setSaving(true);
                }}
                className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-sm hover:bg-accent cursor-pointer disabled:opacity-50"
                disabled={!!active}
              >
                <BookmarkPlus className="size-4 text-muted-foreground" />
                {active ? 'Current filters are already saved' : 'Save current view…'}
              </button>
            </div>
          )}
        </PopoverContent>
      </Popover>
      <SaveViewDialog open={saving} onOpenChange={setSaving} query={rawQuery} />
    </>
  );
}

/* -------------------------------- Share -------------------------------- */

export function ShareMenu() {
  const { range } = useFilters();
  const copy = (frozen: boolean) => {
    const url = new URL(window.location.href);
    url.searchParams.delete('page');
    if (frozen && range.kind === 'relative') {
      const { from, to } = resolveRange(range);
      url.searchParams.set('range', 'abs');
      url.searchParams.set('from', String(Math.round(from)));
      url.searchParams.set('to', String(Math.round(to)));
    }
    void copyWithToast(url.toString(), frozen ? 'Link copied with a fixed time window' : 'Link copied');
  };
  return (
    <DropdownMenu>
      <Tooltip content="Share this view">
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon" aria-label="Share">
            <Link2 />
          </Button>
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>Share this view</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => copy(false)}>
          <Link2 />
          <div>
            <div>Copy link</div>
            <div className="text-[11px] text-muted-foreground">
              {range.kind === 'relative' ? `Opens “${range.label.toLowerCase()}” at the time it's opened` : 'Same filters and time window'}
            </div>
          </div>
        </DropdownMenuItem>
        {range.kind === 'relative' && (
          <DropdownMenuItem onSelect={() => copy(true)}>
            <Clock />
            <div>
              <div>Copy link to this exact window</div>
              <div className="text-[11px] text-muted-foreground">Freezes the time range so everyone sees the same data</div>
            </div>
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <div className="px-2 py-1.5 text-[11px] text-muted-foreground">Links include project, application, user and time filters.</div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
