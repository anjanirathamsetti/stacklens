'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Eye, EyeOff, FlaskConical, Info, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useConfigValue } from '@/lib/use-config';
import { useCan } from '@/lib/current-user';
import { cn } from '@/lib/utils';
import type { AiFeatureId } from '@/lib/api-types';

/** Gradient sparkle mark used on every AI entry point. */
export function AiMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'grid size-6 shrink-0 place-items-center rounded-md bg-gradient-to-br from-violet-500/15 to-brand/15 text-violet-600 dark:text-violet-300',
        className,
      )}
    >
      <Sparkles className="size-3.5" />
    </span>
  );
}

export function AiBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md bg-gradient-to-r from-violet-500/12 to-brand/12 px-1.5 py-0.5 text-[10.5px] font-semibold text-violet-700 dark:text-violet-300',
        className,
      )}
    >
      <Sparkles className="size-3" /> AI
    </span>
  );
}

export type AiAvailability = 'off' | 'feature-off' | 'preview';

/**
 * Where an AI feature stands. There is no AI backend yet, so the best case is "preview":
 * configured and switched on, with generation still to be built.
 */
export function useAiFeature(feature: AiFeatureId): { state: AiAvailability; reason: string } {
  const { config } = useConfigValue('ai');
  if (!config.enabled) return { state: 'off', reason: 'AI features are turned off. Choose a provider to turn them on.' };
  if (!config.features[feature]) return { state: 'feature-off', reason: 'This AI feature is switched off in AI settings.' };
  return { state: 'preview', reason: 'Generation isn’t built yet. This shows where the answer will appear.' };
}

/** Notice explaining why an AI action can't run yet, with a link to the settings. */
export function AiNotice({ state, reason, className }: { state: AiAvailability; reason: string; className?: string }) {
  const isAdmin = useCan('admin');
  return (
    <div className={cn('flex items-start gap-2 rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground', className)}>
      <Info className="mt-px size-3.5 shrink-0" />
      <div className="min-w-0 flex-1">
        {reason}{' '}
        {isAdmin ? (
          <Link href="/admin/ai" className="font-medium text-brand hover:underline">
            {state === 'preview' ? 'AI settings' : 'Set up AI'}
          </Link>
        ) : (
          state !== 'preview' && <span>Ask an admin to set it up.</span>
        )}
      </div>
    </div>
  );
}

/** Frame around illustrative output so it can't be mistaken for a real answer. */
export function ExampleFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative rounded-lg border border-dashed border-violet-400/40 bg-violet-500/[0.03] p-3 pt-6">
      <span className="absolute left-2.5 top-1.5 inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-violet-600/80 dark:text-violet-300/80">
        <FlaskConical className="size-3" /> Example output, not generated from your data
      </span>
      {children}
    </div>
  );
}

/**
 * Card used for in-page AI features (Explain this failure, Explain a slowdown…).
 * Shows the action, its availability and an optional example of the eventual output.
 */
export function AiPanel({
  feature,
  title,
  description,
  action,
  example,
  className,
  compact,
}: {
  feature: AiFeatureId;
  title: string;
  description: string;
  action: string;
  example?: React.ReactNode;
  className?: string;
  compact?: boolean;
}) {
  const { state, reason } = useAiFeature(feature);
  const [tried, setTried] = useState(false);
  const [showExample, setShowExample] = useState(false);
  return (
    <Card className={cn('overflow-hidden border-violet-400/25', className)}>
      <div
        className={cn(
          'flex flex-wrap items-center gap-3 bg-gradient-to-r from-violet-500/[0.05] to-transparent',
          compact ? 'px-3 py-2.5' : 'px-4 py-3',
        )}
      >
        <AiMark className="size-8 rounded-lg" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm font-semibold">
            {title} <AiBadge />
          </div>
          <div className="text-xs text-muted-foreground">{description}</div>
        </div>
        <div className="flex items-center gap-1.5">
          {example && (
            <Button variant="ghost" size="sm" onClick={() => setShowExample((v) => !v)}>
              {showExample ? <EyeOff /> : <Eye />} {showExample ? 'Hide example' : 'Example'}
            </Button>
          )}
          <Button
            size="sm"
            className="bg-gradient-to-r from-violet-600 to-brand text-white hover:opacity-90"
            onClick={() => setTried(true)}
            disabled={state !== 'preview'}
            title={state !== 'preview' ? reason : undefined}
          >
            <Sparkles /> {action}
          </Button>
        </div>
      </div>
      {(state !== 'preview' || tried || showExample) && (
        <div className={cn('space-y-3 border-t', compact ? 'p-3' : 'p-4')}>
          {(state !== 'preview' || tried) && <AiNotice state={state} reason={reason} />}
          {showExample && example && <ExampleFrame>{example}</ExampleFrame>}
        </div>
      )}
    </Card>
  );
}
