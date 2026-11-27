import type { SpanRecord } from './api-types';

export interface SpanNode extends SpanRecord {
  children: SpanNode[];
  depth: number;
  selfTime: number;
  /** number of descendant spans */
  descendants: number;
}

/** Calls a span stands for: 1, or the number of repeated calls folded into it. */
export const callCount = (s: Pick<SpanRecord, 'collapsed'>): number => s.collapsed?.count ?? 1;

/**
 * Time a span actually spent running. For a collapsed span this is the sum of its calls, not its
 * wall-clock window (which also contains the caller's own loop work between calls).
 */
export const busyTime = (s: Pick<SpanRecord, 'collapsed' | 'duration'>): number => (s.collapsed ? s.collapsed.totalDuration : s.duration);

/**
 * Self time = duration minus the union of child intervals (handles parallel async children).
 * Collapsed children contribute their busy time; a collapsed span's self time is its busy time
 * minus its children's busy time.
 */
export function selfTimes(spans: SpanRecord[]): Map<string, number> {
  const byParent = new Map<string, SpanRecord[]>();
  for (const s of spans) {
    if (!s.parentId) continue;
    const arr = byParent.get(s.parentId);
    if (arr) arr.push(s);
    else byParent.set(s.parentId, [s]);
  }
  const out = new Map<string, number>();
  for (const s of spans) {
    const kids = byParent.get(s.id);
    if (!kids?.length) {
      out.set(s.id, busyTime(s));
      continue;
    }
    if (s.collapsed) {
      out.set(s.id, Math.max(0, busyTime(s) - kids.reduce((a, k) => a + busyTime(k), 0)));
      continue;
    }
    const end = s.start + s.duration;
    const collapsedBusy = kids.reduce((a, k) => a + (k.collapsed ? busyTime(k) : 0), 0);
    const ivs = kids
      .filter((k) => !k.collapsed)
      .map((k) => [Math.max(s.start, k.start), Math.min(end, k.start + k.duration)] as const)
      .filter(([a, b]) => b > a)
      .sort((a, b) => a[0] - b[0]);
    let covered = 0;
    let curA = -1;
    let curB = -1;
    for (const [a, b] of ivs) {
      if (a > curB) {
        if (curB > curA) covered += curB - curA;
        curA = a;
        curB = b;
      } else curB = Math.max(curB, b);
    }
    if (curB > curA) covered += curB - curA;
    out.set(s.id, Math.max(0, s.duration - Math.min(s.duration, covered + collapsedBusy)));
  }
  return out;
}

export function buildTree(spans: SpanRecord[]): { roots: SpanNode[]; byId: Map<string, SpanNode> } {
  const self = selfTimes(spans);
  const byId = new Map<string, SpanNode>();
  for (const s of spans) byId.set(s.id, { ...s, children: [], depth: 0, selfTime: self.get(s.id) ?? 0, descendants: 0 });
  const roots: SpanNode[] = [];
  for (const n of byId.values()) {
    const p = n.parentId ? byId.get(n.parentId) : undefined;
    if (p) p.children.push(n);
    else roots.push(n);
  }
  const walk = (n: SpanNode, d: number): number => {
    n.depth = d;
    n.children.sort((a, b) => a.start - b.start);
    n.descendants = n.children.reduce((acc, c) => acc + 1 + walk(c, d + 1), 0);
    return n.descendants;
  };
  roots.sort((a, b) => a.start - b.start).forEach((r) => walk(r, 0));
  return { roots, byId };
}

export function flatten(roots: SpanNode[], collapsed: Set<string>): SpanNode[] {
  const out: SpanNode[] = [];
  const visit = (n: SpanNode) => {
    out.push(n);
    if (!collapsed.has(n.id)) n.children.forEach(visit);
  };
  roots.forEach(visit);
  return out;
}

export function ancestorsOf(id: string, byId: Map<string, SpanNode>): string[] {
  const out: string[] = [];
  let cur = byId.get(id);
  while (cur?.parentId) {
    out.push(cur.parentId);
    cur = byId.get(cur.parentId);
  }
  return out;
}

/**
 * Spans where an error originated (not merely re-thrown by a caller).
 * A failing span is an origin unless one of its children failed with the same message.
 */
export function errorOrigins(spans: SpanRecord[]): Set<string> {
  const failed = spans.filter((s) => s.status === 'error');
  const propagated = new Set<string>();
  const byId = new Map(spans.map((s) => [s.id, s]));
  for (const s of failed) {
    const p = s.parentId ? byId.get(s.parentId) : undefined;
    if (p?.status === 'error' && (!s.error || !p.error || p.error.message.startsWith(s.error.message) || p.error.name === s.error.name)) {
      propagated.add(p.id);
    }
  }
  return new Set(failed.filter((s) => !propagated.has(s.id)).map((s) => s.id));
}
