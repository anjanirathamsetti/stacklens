'use client';
import { Braces, FileText, Link2, ListTree } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { copyWithToast } from '@/components/ui/toast';
import { Tooltip } from '@/components/ui/tooltip';

/** Permanent link to a trace: just the id (plus the selected call), no time filters that could hide it. */
export function traceUrl(traceId: string, spanId?: string): string {
  const url = new URL(`/traces/${traceId}`, window.location.origin);
  if (spanId) url.searchParams.set('span', spanId);
  return url.toString();
}

export function TraceShareMenu({
  traceId,
  title,
  spanId,
  spanName,
  size = 'icon-sm',
}: {
  traceId: string;
  title: string;
  spanId?: string;
  spanName?: string;
  size?: 'icon-sm' | 'icon';
}) {
  return (
    <DropdownMenu>
      <Tooltip content="Share this trace">
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size={size} aria-label="Share trace">
            <Link2 />
          </Button>
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>Share trace</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => copyWithToast(traceUrl(traceId), 'Trace link copied')}>
          <Link2 /> Copy link to this trace
        </DropdownMenuItem>
        {spanId && (
          <DropdownMenuItem onSelect={() => copyWithToast(traceUrl(traceId, spanId), 'Link to the selected call copied')}>
            <ListTree />
            <div className="min-w-0">
              <div>Copy link to the selected call</div>
              {spanName && <div className="truncate font-mono text-[11px] text-muted-foreground">{spanName}</div>}
            </div>
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => copyWithToast(`[${title}](${traceUrl(traceId, spanId)})`, 'Markdown link copied')}>
          <FileText /> Copy as Markdown
          <span className="ml-auto text-[11px] text-muted-foreground">for PRs & tickets</span>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => copyWithToast(traceId, 'Trace ID copied')}>
          <Braces /> Copy trace ID
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
