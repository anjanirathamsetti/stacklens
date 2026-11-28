'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, CheckCircle2 } from 'lucide-react';
import { LanguageTag } from '@/components/data-display/trace-badges';
import type { TraceSummary } from '@stacklens/shared/api-types';

const WINDOW_MIN = 15;
const POLL_MS = 5000;

interface SeenApp {
  name: string;
  count: number;
  lastSeen: number;
}

/**
 * Apps of this language among the recent traces. Only the Python SDK is sure to report its language:
 * Node SDK builds from before `sdk.language` send none, so untagged traces count as Node.js.
 */
function recentApps(traces: TraceSummary[], language: string): SeenApp[] {
  const apps = new Map<string, SeenApp>();
  for (const t of traces) {
    if ((t.language ?? 'node') !== language) continue;
    const a = apps.get(t.application) ?? { name: t.application, count: 0, lastSeen: 0 };
    a.count++;
    a.lastSeen = Math.max(a.lastSeen, t.startTime);
    apps.set(t.application, a);
  }
  return [...apps.values()].sort((a, b) => b.lastSeen - a.lastSeen).slice(0, 5);
}

const ago = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s ago` : `${Math.round(s / 60)}m ago`;
};

/** Watches for traces while the guide is open, so you know the setup worked without leaving the page. */
export function VerifyStep({ language, label }: { language: string; label: string }) {
  const [state, setState] = useState<{ traces: TraceSummary[]; at: number; failed?: boolean }>();

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (!document.hidden) {
        try {
          const r = await fetch(`/api/traces?limit=500&from=${Date.now() - WINDOW_MIN * 60_000}`, { cache: 'no-store' });
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const body = (await r.json()) as { traces: TraceSummary[] };
          if (!stopped) setState({ traces: body.traces, at: Date.now() });
        } catch {
          if (!stopped) setState((s) => ({ traces: s?.traces ?? [], at: Date.now(), failed: true }));
        }
      }
      if (!stopped) timer = setTimeout(poll, POLL_MS);
    };
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, []);

  const apps = state ? recentApps(state.traces, language) : [];
  if (!apps.length)
    return (
      <div role="status" className="flex items-start gap-3 rounded-lg border border-dashed bg-muted/20 p-4">
        {/* a quiet "listening" dot: nothing is loading, the guide is waiting for your app */}
        <span aria-hidden className="mt-1.5 size-2 shrink-0 rounded-full bg-muted-foreground/50" />
        <div className="text-sm">
          <div className="font-medium">
            {!state
              ? 'Checking for recent traces…'
              : state.failed
                ? 'Couldn’t check for traces. Trying again…'
                : `No ${label} traces in the last ${WINDOW_MIN} minutes`}
          </div>
          <div className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            Send a request to your app and it will show up here, with no need to reload. If it doesn’t, check the endpoint and, if the
            server requires one, the API key. The SDK prints a <code className="font-mono">[stacklens]</code> warning when it can’t send.
          </div>
        </div>
      </div>
    );

  return (
    <div role="status" className="overflow-hidden rounded-lg border border-success/40">
      <div className="flex items-center gap-2 border-b border-success/30 bg-success/10 px-4 py-2.5 text-sm font-medium">
        <CheckCircle2 className="size-4 text-success" />
        Receiving {label} traces
        <span className="text-xs font-normal text-muted-foreground">last {WINDOW_MIN} minutes</span>
      </div>
      <ul className="divide-y">
        {apps.map((a) => (
          <li key={a.name}>
            <Link
              href={`/traces?app=${encodeURIComponent(a.name)}`}
              className="group flex items-center gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-accent/50"
            >
              <span className="min-w-0 truncate font-mono text-[12.5px] font-medium">{a.name}</span>
              <LanguageTag language={language} />
              <span className="ml-auto shrink-0 text-xs text-muted-foreground">latest {ago(state!.at - a.lastSeen)}</span>
              <ArrowRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
