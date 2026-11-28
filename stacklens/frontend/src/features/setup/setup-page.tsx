'use client';
import { Suspense, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Check, KeyRound, Lightbulb, ShieldCheck } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { LanguageIcon } from '@/components/brand/language-icon';
import { CodeBlock } from '@/components/data-display/code-block';
import { Card } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useCurrentUser } from '@/lib/current-user';
import { cn } from '@/lib/utils';
import { LANGUAGES, OPTIONS, type LanguageGuide, type Snippet } from './snippets';
import { VerifyStep } from './verify-step';

const SECTIONS = [
  { id: 'install', label: 'Install the SDK' },
  { id: 'instrument', label: 'Instrument your app' },
  { id: 'connect', label: 'Connect to this server' },
  { id: 'verify', label: 'Send a request' },
  { id: 'more', label: 'Instrument anything else' },
  { id: 'options', label: 'Options' },
];

/** This server's address as the browser sees it (the server render shows the default). */
const useOrigin = () =>
  useSyncExternalStore(
    () => () => {},
    () => window.location.origin,
    () => 'http://localhost:4300',
  );

function Snippets({ items }: { items: Snippet[] }) {
  return (
    <div className="space-y-3">
      {items.map((s) => (
        <CodeBlock key={`${s.file}${s.code}`} code={s.code} language={s.language} title={s.file} />
      ))}
    </div>
  );
}

function Step({ n, id, title, last, children }: { n: number; id: string; title: string; last?: boolean; children: React.ReactNode }) {
  return (
    <section id={id} className={cn('relative scroll-mt-4 pl-11', !last && 'pb-9')}>
      {/* the rail joining the step numbers */}
      {!last && <span aria-hidden className="absolute bottom-1 left-[13.5px] top-9 w-px bg-border" />}
      <span className="absolute left-0 top-0 grid size-7 place-items-center rounded-full border bg-card font-mono text-xs font-semibold shadow-xs">
        {n}
      </span>
      <h2 className="mb-2 pt-1 text-sm font-semibold">{title}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

const Hint = ({ children }: { children: React.ReactNode }) => (
  <p className="text-[13px] leading-relaxed text-muted-foreground">{children}</p>
);

function LanguagePicker({ current, onPick }: { current: LanguageGuide; onPick: (id: string) => void }) {
  return (
    <div role="radiogroup" aria-label="Language" className="grid gap-3 sm:grid-cols-2">
      {LANGUAGES.map((l) => {
        const on = l.id === current.id;
        return (
          <button
            key={l.id}
            role="radio"
            aria-checked={on}
            onClick={() => onPick(l.id)}
            className={cn(
              'flex items-center gap-3 rounded-xl border bg-card p-3.5 text-left transition-all cursor-pointer',
              on ? 'border-viz ring-2 ring-viz/25' : 'hover:border-foreground/25',
            )}
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-lg border bg-muted/40">
              <LanguageIcon language={l.id} className="size-6" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">{l.label}</span>
              <span className="block truncate text-xs text-muted-foreground">{l.tagline}</span>
            </span>
            <span className={cn('grid size-5 shrink-0 place-items-center rounded-full border', on && 'border-viz bg-viz text-white')}>
              {on && <Check className="size-3" />}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function OptionsTable({ language }: { language: LanguageGuide }) {
  return (
    <Card className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-left text-xs">
        <thead>
          <tr className="border-b bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
            <th className="px-4 py-2 font-medium">Option</th>
            <th className="px-3 py-2 font-medium">Default</th>
            <th className="px-4 py-2 font-medium">What it does</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {OPTIONS.map((o) => (
            <tr key={o.node} className="align-top">
              <td className="px-4 py-2.5">
                <code className="font-mono text-[11.5px] font-semibold">{o[language.optionKey]}</code>
                {o.env && <code className="mt-0.5 block font-mono text-[10.5px] text-muted-foreground">{o.env}</code>}
              </td>
              <td className="max-w-[180px] break-words px-3 py-2.5 font-mono text-[11px] text-muted-foreground">{o.fallback}</td>
              <td className="px-4 py-2.5 leading-relaxed">{o.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function SetupGuide() {
  const router = useRouter();
  const sp = useSearchParams();
  const { can } = useCurrentUser();
  const origin = useOrigin();
  const language = LANGUAGES.find((l) => l.id === sp.get('lang')) ?? LANGUAGES[0];
  const stack = language.stacks.find((s) => s.id === sp.get('stack')) ?? language.stacks[0];
  const pick = (lang: string, next?: string) => router.replace(`/setup?lang=${lang}${next ? `&stack=${next}` : ''}`, { scroll: false });

  // the key line stays commented out: the server rejects any key it doesn't know, even when none is required
  const envFile = `# where your app sends traces\nSTACKLENS_ENDPOINT=${origin}/api/ingest\n\n# only if this server requires an API key\n# STACKLENS_API_KEY=slk_your_key`;
  const readme = `https://github.com/anjanirathamsetti/stacklens/blob/main/sdks/${language.id}-tracer/README.md`;

  return (
    <div className="flex-1 overflow-y-auto scroll-smooth">
      <div className="mx-auto flex max-w-6xl items-start justify-center gap-10 px-4 py-6 sm:px-6">
        <div className="min-w-0 max-w-3xl flex-1">
          <div className="mb-8">
            <h2 className="text-xl font-semibold tracking-tight">Send your first trace</h2>
            <p className="mb-4 mt-1 text-sm text-muted-foreground">
              Add StackLens where requests enter your API. Every call then arrives with its arguments, return value, errors and SQL.
            </p>
            <LanguagePicker current={language} onPick={(id) => pick(id)} />
          </div>

          <Step n={1} id="install" title="Install the SDK">
            <Hint>
              <code className="font-mono text-foreground">{language.packageName}</code>. {language.installNote}
            </Hint>
            <Snippets items={language.install} />
          </Step>

          <Step n={2} id="instrument" title="Instrument your app">
            <Tabs value={stack.id} onValueChange={(id) => pick(language.id, id)}>
              <TabsList className="h-auto max-w-full flex-wrap justify-start">
                {language.stacks.map((s) => (
                  <TabsTrigger key={s.id} value={s.id}>
                    {s.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            <Hint>{stack.summary}</Hint>
            <Snippets items={stack.snippets} />
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-xs font-medium text-muted-foreground">You’ll see</span>
              {stack.captures.map((c) => (
                <span key={c} className="inline-flex items-center gap-1 rounded-md border bg-card px-2 py-1 text-xs">
                  <Check className="size-3 text-success" />
                  {c}
                </span>
              ))}
            </div>
            {stack.tip && (
              <div className="flex gap-2.5 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5 text-xs leading-relaxed">
                <Lightbulb className="mt-px size-3.5 shrink-0 text-warning" />
                <span>{stack.tip}</span>
              </div>
            )}
          </Step>

          <Step n={3} id="connect" title="Connect to this server">
            <Hint>
              Set these in your app’s environment. The address is the one your browser uses; from a container or another machine, use a host
              name that can reach it.
            </Hint>
            <CodeBlock code={envFile} language="env" title=".env" />
            <div className="flex gap-2.5 rounded-lg border bg-muted/20 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
              <KeyRound className="mt-px size-3.5 shrink-0" />
              <span>
                Uncomment the key line only if an admin has turned on “require an API key”.{' '}
                {can('admin') ? (
                  <Link href="/admin/api-keys" className="font-medium text-foreground underline underline-offset-2">
                    Create a key
                  </Link>
                ) : (
                  'Ask a StackLens admin for a key.'
                )}
              </span>
            </div>
          </Step>

          <Step n={4} id="verify" title="Start your app and send a request" last>
            <Hint>Call any endpoint of your API (or run a job). Its call tree appears on the Traces page within a few seconds.</Hint>
            <VerifyStep key={language.id} language={language.id} label={language.label} />
          </Step>

          <section id="more" className="mt-10 scroll-mt-4 border-t pt-7">
            <h2 className="text-sm font-semibold">{language.extras.title}</h2>
            <p className="mb-3 mt-1 text-[13px] text-muted-foreground">{language.extras.description}</p>
            <Snippets items={[language.extras.snippet]} />
          </section>

          <section id="options" className="mt-10 scroll-mt-4 border-t pt-7">
            <h2 className="text-sm font-semibold">Options</h2>
            <p className="mb-3 mt-1 text-[13px] text-muted-foreground">
              Pass them to <code className="font-mono text-foreground">stacklens.init()</code>
              {' or use the environment variable shown. '}
              <a href={readme} target="_blank" rel="noreferrer" className="font-medium text-foreground underline underline-offset-2">
                All options
              </a>
            </p>
            <OptionsTable language={language} />
            <div className="mt-3 flex gap-2.5 rounded-lg border bg-muted/20 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
              <ShieldCheck className="mt-px size-3.5 shrink-0 text-success" />
              <span>Passwords, tokens, cookies and API keys are redacted inside your app, before a trace is sent.</span>
            </div>
          </section>
        </div>

        <nav aria-label="On this page" className="sticky top-6 hidden w-44 shrink-0 xl:block">
          <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/80">On this page</div>
          <ul className="space-y-0.5 border-l">
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <a
                  href={`#${s.id}`}
                  className="-ml-px block border-l border-transparent py-1 pl-3 text-xs text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
                >
                  {s.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </div>
  );
}

export default function SetupPage() {
  return (
    <>
      <PageHeader title="Setup guide" description="Connect a Node.js or Python app" />
      <Suspense>
        <SetupGuide />
      </Suspense>
    </>
  );
}
