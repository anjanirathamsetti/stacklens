'use client';
import { Suspense } from 'react';
import { Bot, Check, CircleDashed, Cloud, Construction, Cpu, KeyRound, Lock, Server, ShieldCheck, Sparkles, Wallet } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { SaveBar } from '@/components/layout/save-bar';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/toast';
import { useConfigDraft } from '@/lib/use-config';
import { AI_FEATURES } from '@/lib/config-defaults';
import { cn } from '@/lib/utils';
import type { AiConfig, AiProvider } from '@/lib/api-types';
import { AiMark } from './components/ai-primitives';

const PROVIDERS: {
  id: AiProvider;
  label: string;
  hint: string;
  icon: React.ComponentType<{ className?: string }>;
  model: string;
  baseUrl?: string;
}[] = [
  { id: 'anthropic', label: 'Anthropic', hint: 'Claude models', icon: Sparkles, model: 'claude-sonnet-5-5' },
  { id: 'openai', label: 'OpenAI', hint: 'OpenAI API', icon: Bot, model: 'model name' },
  {
    id: 'azure-openai',
    label: 'Azure OpenAI',
    hint: 'Your Azure deployment',
    icon: Cloud,
    model: 'deployment name',
    baseUrl: 'https://<resource>.openai.azure.com',
  },
  { id: 'bedrock', label: 'AWS Bedrock', hint: 'Runs in your AWS account', icon: Cloud, model: 'model id' },
  {
    id: 'ollama',
    label: 'Ollama',
    hint: 'Self-hosted, data stays on your network',
    icon: Server,
    model: 'model name',
    baseUrl: 'http://localhost:11434',
  },
  {
    id: 'openai-compatible',
    label: 'OpenAI-compatible',
    hint: 'vLLM, LM Studio, gateways',
    icon: Cpu,
    model: 'model name',
    baseUrl: 'https://gateway.internal/v1',
  },
];

const WHERE: Record<string, string> = {
  'explain-failure': 'Trace page, on failed requests',
  'explain-slowdown': 'Trace page, on slow requests',
  'error-summary': 'Errors page → Summarize',
  'incident-draft': 'Create incident dialog',
  'nl-search': 'Traces page → Ask AI',
  'generate-tests': 'Call inspector → test tube icon',
};

function Section({
  icon: Icon,
  title,
  description,
  children,
  right,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  children: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <Card className="overflow-hidden">
      <div className="flex items-start gap-3 border-b px-5 py-4">
        <Icon className="mt-0.5 size-4 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">{title}</div>
          <div className="mt-0.5 text-xs text-muted-foreground">{description}</div>
        </div>
        {right}
      </div>
      <div className="p-5">{children}</div>
    </Card>
  );
}

function Row({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 py-2.5">
      <div className="min-w-0">
        <div className="text-sm font-medium">{title}</div>
        {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/** What a request to the model would contain, so people can judge the privacy settings. */
function PayloadPreview({ cfg }: { cfg: AiConfig }) {
  const v = (x: string) => (cfg.privacy.includeValues ? x : '"‹omitted›"');
  const secret = cfg.privacy.redact ? '"[REDACTED]"' : '"s3cr3t-token"';
  return (
    <pre className="overflow-x-auto rounded-md border bg-muted/40 p-3 font-mono text-[11px] leading-relaxed">
      {`{
  "route": "POST /orders",
  "status": 500,
  "calls": [            // up to ${cfg.privacy.maxSpans} calls
    {
      "name": "OrdersService.create",
      "durationMs": 182.4,
      "args": [${v('{ "productId": 9412, "qty": 2 }')}],
      "headers": { "authorization": ${cfg.privacy.includeValues ? secret : '"‹omitted›"'} },
      "error": { "name": "NotFoundError", "message": "Product 9412 not found" }
    }
  ]
}`}
    </pre>
  );
}

function Step({ done, label, detail }: { done: boolean; label: string; detail: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5">
      {done ? (
        <span className="mt-0.5 grid size-4.5 shrink-0 place-items-center rounded-full bg-success text-white">
          <Check className="size-3" />
        </span>
      ) : (
        <CircleDashed className="mt-0.5 size-4.5 shrink-0 text-muted-foreground" />
      )}
      <div className="min-w-0">
        <div className={cn('text-sm font-medium', done && 'text-muted-foreground line-through decoration-muted-foreground/40')}>
          {label}
        </div>
        <div className="text-xs text-muted-foreground">{detail}</div>
      </div>
    </div>
  );
}

function AiInner() {
  const { draft: cfg, update, dirty, save, saving, discard, extras } = useConfigDraft('ai');
  const apiKeySet = extras.apiKeySet === true;
  const provider = PROVIDERS.find((p) => p.id === cfg.provider) ?? PROVIDERS[0];
  const needsKey = cfg.provider !== 'ollama';
  const enabledFeatures = AI_FEATURES.filter((f) => cfg.features[f.id]).length;

  return (
    <>
      <PageHeader title="AI assistant" description="Explain failures, draft incidents and search in plain words">
        <Badge tone={cfg.enabled ? 'brand' : 'neutral'}>
          <span className={cn('size-1.5 rounded-full', cfg.enabled ? 'bg-brand' : 'bg-muted-foreground/50')} />
          {cfg.enabled ? 'Turned on' : 'Off'}
        </Badge>
      </PageHeader>
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl space-y-4 p-6">
          {/* Hero */}
          <Card className="overflow-hidden">
            <div className="grid gap-6 bg-gradient-to-br from-violet-500/[0.06] via-transparent to-brand/[0.05] p-6 md:grid-cols-[1fr_280px]">
              <div>
                <AiMark className="mb-3 size-10 rounded-xl" />
                <h2 className="text-lg font-semibold tracking-tight">Debug with the full call tree, not just a stack trace</h2>
                <p className="mt-1.5 max-w-xl text-sm text-muted-foreground">
                  StackLens records what every function received and returned. The AI reads that, redacted, to explain why a request failed
                  or slowed down, and points at the exact call.
                </p>
                <div className="mt-4 flex items-center gap-3">
                  <Switch checked={cfg.enabled} onCheckedChange={(enabled) => update({ enabled })} aria-label="Turn on AI features" />
                  <span className="text-sm font-medium">Turn on AI features</span>
                </div>
              </div>
              <div className="space-y-3 rounded-lg border bg-card/70 p-4">
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Setup</div>
                <Step
                  done={!!cfg.model}
                  label="Choose a provider and model"
                  detail={cfg.model ? `${provider.label} · ${cfg.model}` : 'Below, under Provider'}
                />
                <Step
                  done={!needsKey || apiKeySet}
                  label="Add the API key on the server"
                  detail={
                    <>
                      Set <code className="font-mono">STACKLENS_AI_API_KEY</code>
                    </>
                  }
                />
                <Step
                  done={cfg.enabled && enabledFeatures > 0}
                  label="Turn on features"
                  detail={`${enabledFeatures} of ${AI_FEATURES.length} selected`}
                />
              </div>
            </div>
            <div className="flex items-start gap-2 border-t bg-amber-500/[0.06] px-5 py-2.5 text-xs text-amber-800 dark:text-amber-200">
              <Construction className="mt-px size-3.5 shrink-0" />
              <span>
                <b>Preview.</b> The AI backend isn’t built yet. These settings are saved, and every AI button in the app shows where its
                answer will appear.
              </span>
            </div>
          </Card>

          <Section
            icon={Sparkles}
            title="Provider"
            description="Which model StackLens talks to. Pick a self-hosted option to keep data on your network."
          >
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {PROVIDERS.map((p) => (
                <button
                  key={p.id}
                  onClick={() =>
                    update({
                      provider: p.id,
                      model: p.id === cfg.provider ? cfg.model : '',
                      baseUrl: p.id === cfg.provider ? cfg.baseUrl : '',
                    })
                  }
                  className={cn(
                    'flex items-start gap-3 rounded-lg border p-3 text-left transition-colors cursor-pointer hover:bg-accent/50',
                    cfg.provider === p.id && 'border-brand/50 bg-brand/[0.05] ring-1 ring-brand/30',
                  )}
                >
                  <p.icon className={cn('mt-0.5 size-4 shrink-0', cfg.provider === p.id ? 'text-brand' : 'text-muted-foreground')} />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{p.label}</span>
                    <span className="block text-xs text-muted-foreground">{p.hint}</span>
                  </span>
                  {cfg.provider === p.id && <Check className="ml-auto size-4 shrink-0 text-brand" />}
                </button>
              ))}
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="block space-y-1.5">
                <span className="text-xs font-medium">Model</span>
                <Input
                  value={cfg.model}
                  placeholder={provider.model}
                  onChange={(e) => update({ model: e.target.value.trim() })}
                  className="font-mono text-xs"
                />
              </label>
              {provider.baseUrl && (
                <label className="block space-y-1.5">
                  <span className="text-xs font-medium">Endpoint URL</span>
                  <Input
                    value={cfg.baseUrl}
                    placeholder={provider.baseUrl}
                    onChange={(e) => update({ baseUrl: e.target.value.trim() })}
                    className="font-mono text-xs"
                  />
                </label>
              )}
            </div>
            {needsKey && (
              <div className="mt-4 flex items-start gap-3 rounded-md border bg-muted/30 px-3 py-2.5">
                <KeyRound className={cn('mt-0.5 size-4 shrink-0', apiKeySet ? 'text-success' : 'text-muted-foreground')} />
                <div className="text-xs leading-relaxed">
                  {apiKeySet ? (
                    <span className="font-medium text-success">API key found on the server.</span>
                  ) : (
                    <span className="font-medium">No API key on the server yet.</span>
                  )}{' '}
                  <span className="text-muted-foreground">
                    Keys are read from the <code className="font-mono">STACKLENS_AI_API_KEY</code> environment variable and never sent to
                    the browser, so there is no field for it here.
                  </span>
                </div>
              </div>
            )}
          </Section>

          <Section
            icon={Bot}
            title="Features"
            description="Choose which AI actions appear in the app."
            right={<span className="text-xs text-muted-foreground">{enabledFeatures} on</span>}
          >
            <div className="divide-y">
              {AI_FEATURES.map((f) => (
                <div key={f.id} className="flex items-center gap-4 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{f.label}</div>
                    <div className="text-xs text-muted-foreground">{f.description}</div>
                    <div className="mt-1 text-[11px] text-muted-foreground/80">Appears in: {WHERE[f.id]}</div>
                  </div>
                  <Switch
                    checked={cfg.features[f.id]}
                    onCheckedChange={(v) => update((c) => ({ features: { ...c.features, [f.id]: v } }))}
                    aria-label={f.label}
                  />
                </div>
              ))}
            </div>
          </Section>

          <div className="grid gap-4 lg:grid-cols-2">
            <Section icon={ShieldCheck} title="Privacy" description="What leaves your server when an AI feature runs.">
              <div className="divide-y">
                <Row title="Redact secrets again" hint="Re-apply redaction (passwords, tokens, cookies…) before sending">
                  <Switch
                    checked={cfg.privacy.redact}
                    onCheckedChange={(redact) => update((c) => ({ privacy: { ...c.privacy, redact } }))}
                    aria-label="Redact"
                  />
                </Row>
                <Row title="Include argument and return values" hint="Off: only names, types, timings and errors are sent">
                  <Switch
                    checked={cfg.privacy.includeValues}
                    onCheckedChange={(includeValues) => update((c) => ({ privacy: { ...c.privacy, includeValues } }))}
                    aria-label="Include values"
                  />
                </Row>
                <div className="space-y-1.5 py-2.5">
                  <div className="text-sm font-medium">Extra keys to mask</div>
                  <Input
                    value={cfg.privacy.extraRedactKeys}
                    placeholder="ssn, iban, dateOfBirth"
                    onChange={(e) => update((c) => ({ privacy: { ...c.privacy, extraRedactKeys: e.target.value } }))}
                    className="font-mono text-xs"
                  />
                </div>
                <Row title="Max calls per request" hint="Larger trees are trimmed to the error path and slowest calls">
                  <Input
                    type="number"
                    min={20}
                    max={5000}
                    value={cfg.privacy.maxSpans}
                    onChange={(e) => update((c) => ({ privacy: { ...c.privacy, maxSpans: Number(e.target.value) } }))}
                    className="w-24 text-right font-mono text-xs"
                  />
                </Row>
              </div>
            </Section>
            <Section icon={Lock} title="What gets sent" description="An example request to the model with your current settings.">
              <PayloadPreview cfg={cfg} />
              <div className="mt-3 flex items-start gap-3 rounded-md border px-3 py-2.5">
                <Wallet className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium">Monthly budget</span>
                    <div className="relative">
                      <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                        $
                      </span>
                      <Input
                        type="number"
                        min={0}
                        value={cfg.monthlyBudgetUsd}
                        onChange={(e) => update({ monthlyBudgetUsd: Math.max(0, Number(e.target.value)) })}
                        className="w-24 pl-5 text-right font-mono text-xs"
                      />
                    </div>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">0 means no cap. Usage this month: no requests yet.</div>
                </div>
              </div>
            </Section>
          </div>

          <SaveBar
            dirty={dirty}
            saving={saving}
            onDiscard={discard}
            onSave={() =>
              save()
                .then(() => toast('AI settings saved'))
                .catch((e: Error) => toast(e.message, 'error'))
            }
          />
        </div>
      </div>
    </>
  );
}

export default function AiPage() {
  return (
    <Suspense>
      <AiInner />
    </Suspense>
  );
}
