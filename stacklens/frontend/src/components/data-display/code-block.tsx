'use client';
import { useMemo, useState } from 'react';
import { FileCode2, SquareTerminal, WrapText } from 'lucide-react';
import { CopyButton } from '@/components/data-display/json-view';
import { highlightLines, type CodeLanguage, type CodeTokenType } from '@/lib/highlight';
import { cn } from '@/lib/utils';

/** Same colour families as the type, JSON and SQL views. */
const TOKEN_CLASS: Record<CodeTokenType, string> = {
  comment: 'text-muted-foreground italic',
  string: 'text-emerald-700 dark:text-emerald-300',
  number: 'text-sky-700 dark:text-sky-300',
  keyword: 'text-violet-700 dark:text-violet-300',
  constant: 'text-sky-700 dark:text-sky-300',
  decorator: 'text-amber-700 dark:text-amber-300',
  function: 'text-blue-700 dark:text-blue-300',
  type: 'text-teal-700 dark:text-teal-300',
  property: 'text-orange-700 dark:text-orange-300',
  variable: 'text-orange-700 dark:text-orange-300',
  flag: 'text-violet-700 dark:text-violet-300',
  punct: 'text-muted-foreground',
  plain: 'text-foreground',
};

const LANGUAGE_LABEL: Record<CodeLanguage, string> = { ts: 'TypeScript', js: 'JavaScript', python: 'Python', bash: 'Shell', env: '.env' };

/** A highlighted snippet with a file name, line numbers (not for shell), a wrap toggle and copy. */
export function CodeBlock({
  code,
  language,
  title,
  className,
}: {
  code: string;
  language: CodeLanguage;
  /** file the snippet belongs in, e.g. `app/main.py` */
  title?: string;
  className?: string;
}) {
  const [wrap, setWrap] = useState(false);
  const lines = useMemo(() => highlightLines(code, language), [code, language]);
  const numbered = language !== 'bash' && lines.length > 1;
  const Icon = language === 'bash' ? SquareTerminal : FileCode2;
  return (
    <figure className={cn('overflow-hidden rounded-lg border bg-muted/30', className)}>
      <figcaption className="flex h-9 items-center gap-2 border-b bg-muted/50 pl-3 pr-1.5">
        <Icon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-foreground/80">{title ?? LANGUAGE_LABEL[language]}</span>
        {title && title !== LANGUAGE_LABEL[language] && (
          <span className="hidden text-[10.5px] text-muted-foreground sm:inline">{LANGUAGE_LABEL[language]}</span>
        )}
        <button
          onClick={() => setWrap((w) => !w)}
          aria-pressed={wrap}
          aria-label="Wrap long lines"
          title="Wrap long lines"
          className={cn(
            'grid size-6 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer',
            wrap && 'bg-accent text-foreground',
          )}
        >
          <WrapText className="size-3.5" />
        </button>
        <CopyButton text={code} />
      </figcaption>
      <pre className="overflow-x-auto py-3 font-mono text-[12px] leading-[1.7] [tab-size:2]">
        <code className={cn('grid', !wrap && 'w-max min-w-full')}>
          {lines.map((line, n) => (
            <span key={n} className="flex px-3 hover:bg-accent/40">
              {numbered && (
                <span aria-hidden className="mr-4 w-5 shrink-0 select-none text-right text-muted-foreground/50">
                  {n + 1}
                </span>
              )}
              <span className={cn('min-h-[1lh] pr-3', wrap ? 'min-w-0 whitespace-pre-wrap break-words' : 'whitespace-pre')}>
                {line.map((t, i) => (
                  <span key={i} className={TOKEN_CLASS[t.type]}>
                    {t.text}
                  </span>
                ))}
              </span>
            </span>
          ))}
        </code>
      </pre>
    </figure>
  );
}
