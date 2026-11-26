import type { AiConfig, AiFeatureId, DigestConfig, McpConfig, McpToolId, SecurityConfig } from './api-types';

/** Defaults for the team-wide config documents in `app_config`. Shared by the server and the UI. */

export const DEFAULT_DIGEST: DigestConfig = {
  enabled: false,
  hour: 9,
  timezone: 'UTC',
  webhookUrl: '',
  format: 'slack',
  project: '',
};

export const AI_FEATURES: { id: AiFeatureId; label: string; description: string }[] = [
  {
    id: 'explain-failure',
    label: 'Explain this failure',
    description: 'Root cause and a suggested fix for a failed trace, from its call tree and values.',
  },
  {
    id: 'explain-slowdown',
    label: 'Explain a slowdown',
    description: 'Compares a slow trace with a typical one for the same route and describes the difference.',
  },
  {
    id: 'error-summary',
    label: 'Error group summaries',
    description: 'A plain-language summary of each error group: impact, likely cause, affected routes.',
  },
  {
    id: 'incident-draft',
    label: 'Incident drafts',
    description: 'Writes the ServiceNow ticket: summary, impact, suspected cause and affected endpoints.',
  },
  {
    id: 'nl-search',
    label: 'Natural-language search',
    description: 'Type a question like "slow checkouts for user 42 today" and get the matching filters.',
  },
  {
    id: 'generate-tests',
    label: 'Tests from real traffic',
    description: 'Turns a recorded call (inputs and outputs) into a unit test for that function.',
  },
];

export const DEFAULT_AI: AiConfig = {
  enabled: false,
  provider: 'anthropic',
  model: '',
  baseUrl: '',
  features: Object.fromEntries(AI_FEATURES.map((f) => [f.id, true])) as Record<AiFeatureId, boolean>,
  privacy: { redact: true, includeValues: true, extraRedactKeys: '', maxSpans: 400 },
  monthlyBudgetUsd: 0,
};

export const MCP_TOOLS: { id: McpToolId; description: string; params: string; access: 'read' }[] = [
  {
    id: 'search_traces',
    description: 'Find requests by route, status, user, application or time range.',
    params: 'query?, route?, status?, user?, from?, to?, limit?',
    access: 'read',
  },
  {
    id: 'get_trace',
    description: 'The full call tree of one request with inputs, outputs, errors and logs.',
    params: 'traceId',
    access: 'read',
  },
  {
    id: 'get_span',
    description: 'One function call from a trace: arguments, return value, inferred types.',
    params: 'traceId, spanId',
    access: 'read',
  },
  {
    id: 'list_error_groups',
    description: 'Exceptions grouped by where they were thrown, with counts and trends.',
    params: 'application?, from?, to?, limit?',
    access: 'read',
  },
  {
    id: 'get_error_group',
    description: 'One error group with sample traces, affected routes and users.',
    params: 'errorId',
    access: 'read',
  },
  {
    id: 'get_hotspots',
    description: 'Functions ranked by self time, calls, p95 or errors.',
    params: 'kind?, sort?, limit?',
    access: 'read',
  },
  {
    id: 'get_metrics',
    description: 'Request rate, error rate and latency percentiles for a time range.',
    params: 'application?, route?, from?, to?',
    access: 'read',
  },
  { id: 'list_slos', description: 'Service level objectives with their attainment and error budget.', params: '—', access: 'read' },
  { id: 'list_incidents', description: 'ServiceNow incidents linked to error groups.', params: 'state?', access: 'read' },
];

export const DEFAULT_MCP: McpConfig = {
  enabled: false,
  tools: Object.fromEntries(MCP_TOOLS.map((t) => [t.id, true])) as Record<McpToolId, boolean>,
  projects: [],
  redactPayloads: false,
  maxResults: 50,
};

export const DEFAULT_SECURITY: SecurityConfig = {
  requireIngestKey: false,
  sessionDays: 14,
  minPasswordLength: 10,
};

export const CONFIG_DEFAULTS = { digest: DEFAULT_DIGEST, ai: DEFAULT_AI, mcp: DEFAULT_MCP, security: DEFAULT_SECURITY } as const;
export type ConfigKey = keyof typeof CONFIG_DEFAULTS;
export type ConfigOf<K extends ConfigKey> = (typeof CONFIG_DEFAULTS)[K];

/** Stored values over defaults, one level deep for nested objects (features, tools, privacy). */
export function mergeConfig<K extends ConfigKey>(key: K, raw: unknown): ConfigOf<K> {
  const base = CONFIG_DEFAULTS[key] as unknown as Record<string, unknown>;
  const stored = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(stored)) {
    if (!(k in base) && !['lastSentAt', 'lastError', 'lastSentDay'].includes(k)) continue;
    const b = base[k];
    out[k] = b && typeof b === 'object' && !Array.isArray(b) && v && typeof v === 'object' ? { ...b, ...(v as object) } : v;
  }
  return out as unknown as ConfigOf<K>;
}
