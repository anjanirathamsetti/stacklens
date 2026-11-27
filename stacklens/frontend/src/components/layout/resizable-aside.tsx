'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

const read = (key: string, fallback: number) => {
  try {
    const v = Number(localStorage.getItem(key));
    return Number.isFinite(v) && v > 0 ? v : fallback;
  } catch {
    return fallback;
  }
};

/**
 * Right-hand panel with a draggable left edge. It starts at `defaultWidth` and can be dragged wider
 * (to the left) up to the space that leaves `minMain` for the content beside it; it never gets
 * narrower than `defaultWidth`. Double-click the edge to reset. The width is remembered per browser.
 */
export function ResizableAside({
  children,
  className,
  defaultWidth = 460,
  minMain = 420,
  storageKey,
  style,
}: {
  children: React.ReactNode;
  className?: string;
  defaultWidth?: number;
  minMain?: number;
  storageKey: string;
  style?: React.CSSProperties;
}) {
  const ref = useRef<HTMLElement>(null);
  // the panel only renders client-side (after a span is selected), so reading storage here is safe
  const [width, setWidth] = useState(() => (typeof window === 'undefined' ? defaultWidth : read(storageKey, defaultWidth)));
  const [dragging, setDragging] = useState(false);

  const clamp = useCallback(
    (w: number) => {
      const container = ref.current?.parentElement?.getBoundingClientRect().width ?? Infinity;
      return Math.round(Math.max(defaultWidth, Math.min(w, container - minMain)));
    },
    [defaultWidth, minMain],
  );

  // keep the panel within bounds when the window gets smaller
  useEffect(() => {
    const onResize = () => setWidth((w) => clamp(w));
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [clamp]);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, String(width));
    } catch {
      /* storage unavailable */
    }
  }, [storageKey, width]);

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const right = ref.current?.getBoundingClientRect().right ?? 0;
    setDragging(true);
    const move = (ev: PointerEvent) => setWidth(clamp(right - ev.clientX));
    const up = () => {
      setDragging(false);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  return (
    <aside ref={ref} className={cn('relative shrink-0', className)} style={{ ...style, width }}>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize the call inspector"
        aria-valuenow={width}
        tabIndex={0}
        title="Drag to resize · double-click to reset"
        onPointerDown={onPointerDown}
        onDoubleClick={() => setWidth(defaultWidth)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') setWidth((w) => clamp(w + 40));
          if (e.key === 'ArrowRight') setWidth((w) => clamp(w - 40));
        }}
        className="group absolute inset-y-0 -left-1.5 z-20 w-3 cursor-col-resize outline-none"
      >
        <span
          className={cn(
            'absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors group-hover:bg-brand/60 group-focus-visible:bg-brand',
            dragging && 'w-0.5 bg-brand',
          )}
        />
        <span
          className={cn(
            'absolute left-1/2 top-1/2 h-8 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-border opacity-0 transition-opacity group-hover:opacity-100',
            dragging && 'bg-brand opacity-100',
          )}
        />
      </div>
      {children}
    </aside>
  );
}
