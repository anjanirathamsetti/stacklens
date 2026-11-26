'use client';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** Sticky "unsaved changes" bar for settings-style pages. */
export function SaveBar({
  dirty,
  saving,
  onSave,
  onDiscard,
}: {
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
  onDiscard: () => void;
}) {
  if (!dirty) return null;
  return (
    <div
      className="sticky bottom-4 z-20 mx-auto flex w-fit items-center gap-3 rounded-full border bg-popover py-1.5 pl-4 pr-1.5 shadow-lg"
      style={{ animation: 'menu-in 140ms ease-out' }}
    >
      <span className="text-sm">Unsaved changes</span>
      <Button variant="ghost" size="sm" className="rounded-full" onClick={onDiscard} disabled={saving}>
        Discard
      </Button>
      <Button size="sm" className="rounded-full" onClick={onSave} disabled={saving}>
        {saving && <Loader2 className="animate-spin" />} Save
      </Button>
    </div>
  );
}
