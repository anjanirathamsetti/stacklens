import { isPythonTraceback, stackFrames } from '@stacklens/shared/language';
import { cn } from '@/lib/utils';

const PY_FRAME = /^(\s*)File "(.+)", line (\d+), in (.+)$/;

/** `/srv/app/.venv/lib/python3.12/site-packages/httpx/_models.py` → `httpx/_models.py`; app files keep their last three parts. */
function shortPath(path: string): string {
  const site = path.split(/[\\/](?:site|dist)-packages[\\/]/);
  if (site.length > 1) return site[site.length - 1];
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length > 3 ? `…/${parts.slice(-3).join('/')}` : path;
}

const isLibrary = (path: string) => /[\\/](?:site|dist)-packages[\\/]|[\\/]lib[\\/]python\d/.test(path);

/**
 * The frames of an error's stack trace. Python tracebacks are laid out frame by frame (file, line and
 * function, then the source line), with library frames dimmed; other stacks are shown as text.
 */
export function StackView({ error, className }: { error: { name: string; message: string; stack?: string }; className?: string }) {
  const frames = stackFrames(error);
  const box = cn('overflow-auto rounded-md bg-muted/50 p-2.5 font-mono text-[10.5px] leading-relaxed text-muted-foreground', className);
  if (!isPythonTraceback(error.stack)) return <pre className={box}>{frames}</pre>;
  const lines = frames.split('\n');
  const out: React.ReactNode[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = PY_FRAME.exec(line);
    if (!m) {
      const trimmed = line.trim();
      // a header ("Traceback …", "During handling of the above exception …") or a chained exception's message
      const header = /^(Traceback \(most recent call last\):|During handling|The above exception)/.test(trimmed);
      out.push(
        <div
          key={i}
          className={cn('whitespace-pre-wrap break-words', header ? 'text-muted-foreground/80 italic' : trimmed && 'text-foreground')}
        >
          {trimmed || ' '}
        </div>,
      );
      continue;
    }
    const [, , path, lineNo, fn] = m;
    const lib = isLibrary(path);
    // the source line (and Python 3.11+ caret markers) that follow a frame
    const source: string[] = [];
    while (i + 1 < lines.length && !PY_FRAME.test(lines[i + 1]) && /^\s{4,}/.test(lines[i + 1])) source.push(lines[++i].trim());
    const code = source.filter((s) => !/^[\^~\s]+$/.test(s));
    out.push(
      <div key={i} className={cn('py-0.5', lib && 'opacity-60')}>
        <div className="flex flex-wrap items-baseline gap-x-1.5">
          <span className="font-semibold text-foreground">{fn}</span>
          <span title={path} className="break-all">
            {shortPath(path)}:{lineNo}
          </span>
          {lib && <span className="rounded bg-muted px-1 text-[9.5px]">library</span>}
        </div>
        {code.length > 0 && <div className="whitespace-pre-wrap break-words pl-3 text-foreground/80">{code.join(' ')}</div>}
      </div>,
    );
  }
  return <div className={box}>{out}</div>;
}
