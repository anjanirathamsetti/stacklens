'use client';
import { useState } from 'react';
import { ArrowRight, Boxes, Clock, CornerDownLeft, FlaskConical, Sparkles, User, Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { AiBadge, AiMark, AiNotice, AiPanel, ExampleFrame, useAiFeature } from './ai-primitives';

/* --------------------------- Trace detail panels --------------------------- */

function ExampleSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</div>
      <div className="text-sm leading-relaxed">{children}</div>
    </div>
  );
}

const code = (s: string) => <code className="rounded bg-muted px-1 py-0.5 font-mono text-[12px]">{s}</code>;

export function ExplainFailurePanel() {
  return (
    <AiPanel
      feature="explain-failure"
      title="Explain this failure"
      description="Root cause and a suggested fix, from this call tree and the values each call received."
      action="Explain"
      example={
        <div className="space-y-3">
          <ExampleSection title="What happened">
            {code('OrdersController.create')} called {code('InventoryService.reserve')}, which threw {code('NotFoundError')} because{' '}
            {code('ProductRepository.findById')} returned {code('null')} for {code('productId: 9412')}.
          </ExampleSection>
          <ExampleSection title="Likely root cause">
            The product was soft-deleted 2 hours earlier, but the cart still referenced it. {code('reserve')} assumes the product exists.
          </ExampleSection>
          <ExampleSection title="Suggested fix">
            <pre className="mt-1 overflow-x-auto rounded-md border bg-card p-2.5 font-mono text-[11.5px] leading-relaxed">
              <span className="text-muted-foreground">{'// inventory.service.ts'}</span>
              {'\n'}
              <span className="text-destructive">{'- const product = await this.products.findById(id);'}</span>
              {'\n'}
              <span className="text-success">{'+ const product = await this.products.findActiveById(id);'}</span>
              {'\n'}
              <span className="text-success">{"+ if (!product) throw new BadRequestException('Product is no longer available');"}</span>
            </pre>
          </ExampleSection>
          <div className="flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
            <span className="rounded-md border px-1.5 py-0.5">Confidence: high</span>
            <span className="rounded-md border px-1.5 py-0.5">Based on 14 calls, 3 SQL queries</span>
            <span className="rounded-md border px-1.5 py-0.5">Similar failures: 37 in 24h</span>
          </div>
        </div>
      }
    />
  );
}

export function ExplainSlowdownPanel() {
  return (
    <AiPanel
      feature="explain-slowdown"
      title="Explain this slowdown"
      description="Compares this request with a typical one for the same route and explains the difference."
      action="Compare & explain"
      example={
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            {[
              ['This request', '1.84s'],
              ['Typical (p50)', '212ms'],
              ['Extra time', '+1.63s'],
            ].map(([l, v]) => (
              <div key={l} className="rounded-md border bg-card px-2 py-1.5">
                <div className="text-muted-foreground">{l}</div>
                <div className="font-mono font-semibold">{v}</div>
              </div>
            ))}
          </div>
          <ExampleSection title="Why it was slower">
            {code('ReportService.build')} ran {code('LineItemRepository.findByOrder')} <b>48 times</b> in a loop (typical: 1 batched query).
            This N+1 pattern accounts for 1.41s of the extra time.
          </ExampleSection>
          <ExampleSection title="Suggestion">Load line items once with {code('In(orderIds)')} before the loop.</ExampleSection>
        </div>
      }
    />
  );
}

/* ------------------------------- Ask AI search ------------------------------ */

const PROMPTS = [
  'Slow checkouts for enterprise users today',
  'Failed POST requests in billing-api since 9am',
  'Requests from user 42 that took over 1s',
  'Errors thrown in a repository this week',
];

export function AskAiButton() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const { state, reason } = useAiFeature('nl-search');
  return (
    <>
      <Tooltip content="Describe what you're looking for in plain words">
        <Button variant="outline" onClick={() => setOpen(true)} className="border-violet-400/30">
          <Sparkles className="text-violet-500" /> Ask AI
        </Button>
      </Tooltip>
      <Dialog
        open={open}
        onOpenChange={(v) => {
          setOpen(v);
          if (!v) setSubmitted(false);
        }}
      >
        <DialogContent className="w-[min(620px,calc(100vw-32px))] p-0">
          <DialogTitle className="sr-only">Ask AI</DialogTitle>
          <DialogDescription className="sr-only">Describe the requests you want to find</DialogDescription>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setSubmitted(true);
            }}
            className="flex items-center gap-3 border-b px-4 py-3 pr-12"
          >
            <AiMark className="size-8 rounded-lg" />
            <input
              autoFocus
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setSubmitted(false);
              }}
              placeholder="e.g. slow checkouts for user 42 in the last 2 hours"
              className="h-9 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            <kbd className="hidden items-center gap-1 rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:inline-flex">
              <CornerDownLeft className="size-3" /> Enter
            </kbd>
          </form>
          <div className="space-y-4 p-4">
            {submitted || state !== 'preview' ? <AiNotice state={state} reason={reason} /> : null}
            <div>
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Try</div>
              <div className="flex flex-wrap gap-1.5">
                {PROMPTS.map((p) => (
                  <button
                    key={p}
                    onClick={() => {
                      setQ(p);
                      setSubmitted(false);
                    }}
                    className="rounded-full border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-violet-400/50 hover:text-foreground cursor-pointer"
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
            <ExampleFrame>
              <div className="space-y-2.5">
                <div className="text-xs text-muted-foreground">“Slow checkouts for user 42 in the last 2 hours” becomes these filters:</div>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    [Boxes, 'app: shop-api'],
                    [ArrowRight, 'route: POST /checkout'],
                    [User, 'user: 42'],
                    [Clock, 'last 2 hours'],
                    [Wand2, 'duration ≥ 1s'],
                  ].map(([Icon, l]) => {
                    const I = Icon as typeof Boxes;
                    return (
                      <span
                        key={l as string}
                        className="inline-flex items-center gap-1.5 rounded-md border border-brand/30 bg-brand/[0.06] px-2 py-1 text-xs"
                      >
                        <I className="size-3.5 text-brand" /> {l as string}
                      </span>
                    );
                  })}
                </div>
                <div className="text-[11px] text-muted-foreground">The AI only fills in filters, so it never runs queries of its own.</div>
              </div>
            </ExampleFrame>
          </div>
          <div className="flex items-center justify-between border-t bg-muted/30 px-4 py-2.5">
            <AiBadge />
            <Button size="sm" disabled>
              Apply filters
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/* --------------------------- Tests from real traffic ------------------------ */

export function GenerateTestButton({ functionName, className }: { functionName: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const [framework, setFramework] = useState('vitest');
  const { state, reason } = useAiFeature('generate-tests');
  const [tried, setTried] = useState(false);
  const fn = functionName.split('.').pop() ?? functionName;
  const cls = functionName.includes('.') ? functionName.split('.')[0] : undefined;
  return (
    <>
      <Tooltip content="Generate a unit test from this recorded call">
        <button
          onClick={() => setOpen(true)}
          className={cn('grid size-6 place-items-center rounded text-violet-500 hover:bg-violet-500/10 cursor-pointer', className)}
          aria-label="Generate test"
        >
          <FlaskConical className="size-3.5" />
        </button>
      </Tooltip>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="w-[min(680px,calc(100vw-32px))]">
          <div className="mb-4 flex items-start gap-3 pr-8">
            <AiMark className="size-9 rounded-lg" />
            <div>
              <DialogTitle className="flex items-center gap-2">
                Generate a test <AiBadge />
              </DialogTitle>
              <DialogDescription>
                Turns the recorded inputs and output of <span className="font-mono">{functionName}</span> into a unit test, with its
                dependencies mocked from the child calls.
              </DialogDescription>
            </div>
          </div>
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Select value={framework} onChange={(e) => setFramework(e.target.value)} className="w-36">
                <option value="vitest">Vitest</option>
                <option value="jest">Jest</option>
                <option value="node">node:test</option>
                <option value="mocha">Mocha + Chai</option>
              </Select>
              <Select value="mock" onChange={() => {}} className="w-48">
                <option value="mock">Mock child calls</option>
                <option value="integration">Integration (real deps)</option>
              </Select>
              <Button
                size="sm"
                className="ml-auto bg-gradient-to-r from-violet-600 to-brand text-white hover:opacity-90"
                disabled={state !== 'preview'}
                onClick={() => setTried(true)}
              >
                <Sparkles /> Generate
              </Button>
            </div>
            {(state !== 'preview' || tried) && <AiNotice state={state} reason={reason} />}
            <ExampleFrame>
              <pre className="overflow-x-auto font-mono text-[11.5px] leading-relaxed">
                {`import { describe, it, expect, ${framework === 'jest' ? 'jest' : 'vi'} } from '${framework === 'jest' ? '@jest/globals' : framework}';
${cls ? `import { ${cls} } from './${cls.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()}';` : ''}

describe('${functionName}', () => {
  it('returns the recorded result for a known input', async () => {
    const repo = { findById: ${framework === 'jest' ? 'jest' : 'vi'}.fn().mockResolvedValue({ id: 42, name: 'Ada' }) };
    ${cls ? `const subject = new ${cls}(repo as any);` : ''}
    const result = await ${cls ? `subject.${fn}` : fn}(42);
    expect(repo.findById).toHaveBeenCalledWith(42);
    expect(result).toEqual({ id: 42, name: 'Ada' });
  });
});`}
              </pre>
            </ExampleFrame>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/* ------------------------------ Incident draft ------------------------------ */

export function DraftWithAiButton() {
  const { state, reason } = useAiFeature('incident-draft');
  const [tried, setTried] = useState(false);
  return (
    <span className="inline-flex items-center gap-2">
      {tried && (
        <span className="text-[11px] font-normal text-muted-foreground">
          {state === 'preview' ? 'Not built yet' : reason.split('.')[0]}
        </span>
      )}
      <Tooltip content={state === 'preview' ? 'Write the summary, impact and suspected cause with AI' : reason}>
        <button
          type="button"
          onClick={() => setTried(true)}
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-violet-600 hover:bg-violet-500/10 dark:text-violet-300 cursor-pointer"
        >
          <Sparkles className="size-3" /> Draft with AI
        </button>
      </Tooltip>
    </span>
  );
}

/* ------------------------------- Error summaries ---------------------------- */

export function SummarizeErrorsButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)} className="border-violet-400/30">
        <Sparkles className="text-violet-500" /> Summarize
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="w-[min(640px,calc(100vw-32px))]">
          <DialogTitle className="sr-only">Summarize errors</DialogTitle>
          <DialogDescription className="sr-only">AI summary of the error groups in range</DialogDescription>
          <AiPanel
            feature="error-summary"
            title="Summarize these errors"
            description="Impact, likely cause and affected routes for the error groups in the current range."
            action="Summarize"
            className="mt-5"
            compact
            example={
              <ul className="space-y-2 text-sm">
                <li>
                  <b>3 groups need attention.</b> {code('PaymentGateway.charge')} timeouts make up 61% of server errors and started right
                  after the 14:05 deploy.
                </li>
                <li>{code('UsersService.getById')} NotFound (4xx) is expected client noise: stale links from an old email campaign.</li>
                <li>
                  {code('QueryFailedError')} in {code('OrderRepository')} is new today: a unique constraint on {code('order_number')} is hit
                  under concurrent checkouts.
                </li>
              </ul>
            }
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
