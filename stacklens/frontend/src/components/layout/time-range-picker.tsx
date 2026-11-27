'use client';
import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Input, Select } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { fmtDateTime, parseRelative, resolveRange, type TimeRange } from '@/lib/url-filters';

const QUICK: { group: string; items: string[] }[] = [
  { group: 'Minutes', items: ['5m', '15m', '30m'] },
  { group: 'Hours', items: ['1h', '3h', '6h', '12h'] },
  { group: 'Days', items: ['1d', '3d', '1w'] },
];

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
const pad = (n: number) => String(n).padStart(2, '0');
const toTime = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const toDateInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const withTime = (day: Date, time: string) => {
  const [h, m] = time.split(':').map(Number);
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), h || 0, m || 0).getTime();
};

function Calendar({
  month,
  setMonth,
  start,
  end,
  onPick,
}: {
  month: Date;
  setMonth: (d: Date) => void;
  start?: Date;
  end?: Date;
  onPick: (d: Date) => void;
}) {
  const [hover, setHover] = useState<Date>();
  const days = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const offset = (first.getDay() + 6) % 7; // weeks start on Monday
    return Array.from({ length: 42 }, (_, i) => new Date(month.getFullYear(), month.getMonth(), 1 - offset + i));
  }, [month]);
  const today = startOfDay(new Date());
  const rangeEnd = end ?? (start && hover && hover > start ? hover : undefined);

  return (
    <div className="w-[252px]">
      <div className="mb-2 flex items-center justify-between">
        <Button variant="ghost" size="icon-sm" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>
          <ChevronLeft />
        </Button>
        <div className="text-sm font-medium">{month.toLocaleDateString([], { month: 'long', year: 'numeric' })}</div>
        <Button variant="ghost" size="icon-sm" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>
          <ChevronRight />
        </Button>
      </div>
      <div className="grid grid-cols-7 text-center text-[10px] font-medium uppercase text-muted-foreground">
        {['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((d) => (
          <div key={d} className="py-1">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-y-0.5" onMouseLeave={() => setHover(undefined)}>
        {days.map((d) => {
          const outside = d.getMonth() !== month.getMonth();
          const future = d > today;
          const isStart = start && sameDay(d, start);
          const isEnd = rangeEnd && sameDay(d, rangeEnd);
          const inRange = start && rangeEnd && d > start && d < rangeEnd;
          return (
            <button
              key={d.toISOString()}
              disabled={future}
              onClick={() => onPick(d)}
              onMouseEnter={() => setHover(d)}
              className={cn(
                'h-8 text-xs tabular-nums transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-30',
                outside && 'text-muted-foreground/60',
                inRange && 'bg-brand/12',
                (isStart || isEnd) && 'rounded-md bg-primary font-semibold text-primary-foreground',
                isStart && rangeEnd && !isEnd && 'rounded-r-none',
                isEnd && start && !isStart && 'rounded-l-none',
                !isStart && !isEnd && !inRange && 'rounded-md hover:bg-accent',
                sameDay(d, today) && !isStart && !isEnd && 'font-semibold text-brand',
              )}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function TimeRangePicker({ range, onChange }: { range: TimeRange; onChange: (patch: Record<string, string | undefined>) => void }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'relative' | 'absolute'>(range.kind);
  const [customN, setCustomN] = useState('2');
  const [customU, setCustomU] = useState('h');

  const initial = resolveRange(range);
  const [month, setMonth] = useState(() => startOfDay(new Date(initial.from)));
  const [startDay, setStartDay] = useState<Date | undefined>(startOfDay(new Date(initial.from)));
  const [endDay, setEndDay] = useState<Date | undefined>(startOfDay(new Date(initial.to)));
  const [startTime, setStartTime] = useState(toTime(new Date(initial.from)));
  const [endTime, setEndTime] = useState(toTime(new Date(initial.to)));

  // sync local state whenever the popover opens
  useEffect(() => {
    if (!open) return;
    const r = resolveRange(range);
    setTab(range.kind);
    setMonth(startOfDay(new Date(r.from)));
    setStartDay(startOfDay(new Date(r.from)));
    setEndDay(startOfDay(new Date(r.to)));
    setStartTime(toTime(new Date(r.from)));
    setEndTime(toTime(new Date(r.to)));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const pickDay = (d: Date) => {
    if (!startDay || endDay) {
      setStartDay(d);
      setEndDay(undefined);
    } else if (d < startDay) {
      setEndDay(startDay);
      setStartDay(d);
    } else setEndDay(d);
  };

  const absFrom = startDay ? withTime(startDay, startTime) : undefined;
  const absTo = (endDay ?? startDay) ? withTime(endDay ?? startDay!, endTime) : undefined;
  const absValid = absFrom !== undefined && absTo !== undefined && absTo > absFrom;

  const applyRelative = (code: string) => {
    onChange({ range: code, from: undefined, to: undefined });
    setOpen(false);
  };
  const applyAbsolute = () => {
    if (!absValid) return;
    onChange({ range: 'abs', from: String(absFrom), to: String(absTo) });
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="max-w-[340px] justify-start font-normal">
          {range.kind === 'relative' ? <Clock /> : <CalendarDays />}
          {range.kind === 'relative' && (
            <span className="rounded bg-muted px-1 font-mono text-[11px] font-medium text-muted-foreground">{range.short}</span>
          )}
          <span className="truncate">{range.label}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[600px] p-0">
        <div className="flex items-center gap-1 border-b p-2">
          {(['relative', 'absolute'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                'h-7 rounded-md px-3 text-xs font-medium capitalize cursor-pointer',
                tab === t ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {t}
            </button>
          ))}
          <span className="ml-auto pr-1 text-[11px] text-muted-foreground">
            Local time ({Intl.DateTimeFormat().resolvedOptions().timeZone})
          </span>
        </div>

        {tab === 'relative' ? (
          <div className="space-y-4 p-4">
            {QUICK.map((g) => (
              <div key={g.group} className="flex items-center gap-3">
                <div className="w-16 text-xs text-muted-foreground">{g.group}</div>
                <div className="flex flex-wrap gap-1.5">
                  {g.items.map((code) => {
                    const r = parseRelative(code)!;
                    const active = range.kind === 'relative' && range.code === code;
                    return (
                      <button
                        key={code}
                        onClick={() => applyRelative(code)}
                        className={cn(
                          'h-7 rounded-md border px-2.5 font-mono text-xs cursor-pointer transition-colors',
                          active ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-accent',
                        )}
                        title={r.label}
                      >
                        {code}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
            <div className="flex items-center gap-3 border-t pt-4">
              <div className="w-16 text-xs text-muted-foreground">Custom</div>
              <span className="text-xs text-muted-foreground">Last</span>
              <Input type="number" min={1} value={customN} onChange={(e) => setCustomN(e.target.value)} className="h-7 w-20 text-xs" />
              <Select value={customU} onChange={(e) => setCustomU(e.target.value)} className="h-7 w-28 text-xs">
                <option value="m">minutes</option>
                <option value="h">hours</option>
                <option value="d">days</option>
                <option value="w">weeks</option>
              </Select>
              <Button size="sm" disabled={!(Number(customN) > 0)} onClick={() => applyRelative(`${Math.floor(Number(customN))}${customU}`)}>
                Apply
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex gap-5 p-4">
            <Calendar month={month} setMonth={setMonth} start={startDay} end={endDay} onPick={pickDay} />
            <div className="flex flex-1 flex-col gap-3">
              <div className="space-y-1.5">
                <div className="text-xs font-medium">Start</div>
                <div className="flex gap-1.5">
                  <Input
                    type="date"
                    className="h-7 text-xs"
                    value={startDay ? toDateInput(startDay) : ''}
                    onChange={(e) => e.target.value && setStartDay(startOfDay(new Date(e.target.value + 'T00:00')))}
                  />
                  <Input
                    type="time"
                    className="h-7 w-[118px] shrink-0 px-2 text-xs"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <div className="text-xs font-medium">End</div>
                <div className="flex gap-1.5">
                  <Input
                    type="date"
                    className="h-7 text-xs"
                    value={(endDay ?? startDay) ? toDateInput((endDay ?? startDay)!) : ''}
                    onChange={(e) => e.target.value && setEndDay(startOfDay(new Date(e.target.value + 'T00:00')))}
                  />
                  <Input
                    type="time"
                    className="h-7 w-[118px] shrink-0 px-2 text-xs"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                  />
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {[
                  ['Today', 0],
                  ['Yesterday', 1],
                ].map(([label, ago]) => (
                  <button
                    key={label}
                    onClick={() => {
                      const d = startOfDay(new Date(Date.now() - (ago as number) * 86_400_000));
                      setStartDay(d);
                      setEndDay(d);
                      setStartTime('00:00');
                      setEndTime(ago ? '23:59' : toTime(new Date()));
                    }}
                    className="h-6 rounded-md border px-2 text-[11px] hover:bg-accent cursor-pointer"
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="mt-auto rounded-md bg-muted/50 p-2 text-[11px] text-muted-foreground">
                {absValid ? (
                  <>
                    {fmtDateTime(absFrom!, true)} → {fmtDateTime(absTo!, true)}
                  </>
                ) : (
                  'Pick a start and end date. End must be after start.'
                )}
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button size="sm" disabled={!absValid} onClick={applyAbsolute}>
                  Apply
                </Button>
              </div>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
