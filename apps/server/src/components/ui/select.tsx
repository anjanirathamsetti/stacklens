'use client';
import * as React from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Option {
  value: string;
  label: React.ReactNode;
  text: string;
  disabled?: boolean;
}

function textOf(node: React.ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (React.isValidElement(node)) return textOf((node.props as { children?: React.ReactNode }).children);
  return '';
}

function optionsFrom(children: React.ReactNode): Option[] {
  const out: Option[] = [];
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return;
    const p = child.props as { value?: string | number; children?: React.ReactNode; disabled?: boolean };
    if (child.type === 'option') {
      const text = textOf(p.children);
      out.push({ value: p.value === undefined ? text : String(p.value), label: p.children, text, disabled: p.disabled });
    } else if (p.children) out.push(...optionsFrom(p.children));
  });
  return out;
}

export interface SelectProps {
  value?: string | number;
  onChange?: (e: { target: { value: string } }) => void;
  children?: React.ReactNode;
  className?: string;
  /** Leading icon inside the trigger */
  icon?: React.ComponentType<{ className?: string }>;
  /** Show a search box (defaults to on when there are more than 7 options) */
  searchable?: boolean;
  /** Show an inline clear button when a non-empty value is selected */
  clearable?: boolean;
  align?: 'start' | 'center' | 'end';
  disabled?: boolean;
  'aria-label'?: string;
}

/**
 * Drop-in replacement for a native <select> that matches the design system.
 * Accepts <option> children and fires onChange({ target: { value } }) like the native element.
 */
export function Select({
  value,
  onChange,
  children,
  className,
  icon: Icon,
  searchable,
  clearable,
  align = 'start',
  disabled,
  ...rest
}: SelectProps) {
  const options = React.useMemo(() => optionsFrom(children), [children]);
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [active, setActive] = React.useState(0);
  const listRef = React.useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.value === String(value ?? ''));
  const placeholder = options.find((o) => o.value === '');
  const showSearch = searchable ?? options.length > 7;
  const filtered = query ? options.filter((o) => o.text.toLowerCase().includes(query.toLowerCase())) : options;
  const hasValue = value !== undefined && value !== '' && current?.value !== '';

  const pick = (v: string) => {
    onChange?.({ target: { value: v } });
    setOpen(false);
  };

  React.useEffect(() => {
    if (open) {
      setQuery('');
      setActive(
        Math.max(
          0,
          options.findIndex((o) => o.value === String(value ?? '')),
        ),
      );
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(filtered.length - 1, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const o = filtered[active];
      if (o && !o.disabled) pick(o.value);
    }
  };

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <div className={cn('relative inline-flex', className?.includes('w-full') && 'w-full')}>
        <PopoverPrimitive.Trigger
          disabled={disabled}
          aria-label={rest['aria-label']}
          className={cn(
            'group inline-flex h-8 min-w-0 items-center gap-2 rounded-md border border-input bg-card pl-2.5 pr-2 text-sm shadow-xs transition-colors cursor-pointer',
            'hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 data-[state=open]:border-ring/60 data-[state=open]:bg-accent/40 disabled:opacity-50',
            hasValue && clearable && 'pr-7',
            className,
          )}
        >
          {Icon && <Icon className={cn('size-3.5 shrink-0', hasValue ? 'text-brand' : 'text-muted-foreground')} />}
          <span className={cn('min-w-0 flex-1 truncate text-left', !hasValue && placeholder && 'text-foreground/80')}>
            {current?.label ?? placeholder?.label ?? 'Select…'}
          </span>
          {!(hasValue && clearable) && (
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
          )}
        </PopoverPrimitive.Trigger>
        {hasValue && clearable && (
          <button
            onClick={() => pick('')}
            className="absolute right-1.5 top-1/2 grid size-5 -translate-y-1/2 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer"
            aria-label="Clear"
          >
            <X className="size-3" />
          </button>
        )}
      </div>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align={align}
          sideOffset={6}
          onKeyDown={onKeyDown}
          className="z-[60] min-w-[var(--radix-popover-trigger-width)] max-w-80 overflow-hidden rounded-lg border bg-popover p-1 text-foreground shadow-lg outline-none"
          style={{ animation: 'menu-in 120ms ease-out' }}
        >
          {showSearch && (
            <div className="relative mb-1 border-b pb-1">
              <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                autoFocus
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                }}
                placeholder="Search…"
                className="h-7 w-full rounded-md bg-transparent pl-7 pr-2 text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
          )}
          <div ref={listRef} role="listbox" className="max-h-64 overflow-y-auto">
            {filtered.map((o, i) => {
              const selected = o.value === String(value ?? '');
              return (
                <button
                  key={o.value}
                  data-index={i}
                  role="option"
                  aria-selected={selected}
                  disabled={o.disabled}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(o.value)}
                  className={cn(
                    'flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm cursor-pointer disabled:opacity-40',
                    i === active && 'bg-accent',
                    o.value === '' && 'text-muted-foreground',
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{o.label}</span>
                  <Check className={cn('size-3.5 shrink-0 text-brand', !selected && 'invisible')} />
                </button>
              );
            })}
            {filtered.length === 0 && <div className="px-2 py-3 text-center text-xs text-muted-foreground">No matches</div>}
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
