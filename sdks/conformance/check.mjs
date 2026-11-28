#!/usr/bin/env node
/**
 * StackLens SDK conformance checker (language-agnostic).
 *
 *   <sdk runner> > results.json && node sdks/conformance/check.mjs results.json
 *   <sdk runner> | node sdks/conformance/check.mjs -
 *
 * The input is { "<scenario name>": TraceRecord }. Every trace must validate against the wire
 * contract (packages/contract/schema/trace.schema.json) and meet its scenario's expectations
 * (scenarios.json). Exits 1 on any failure.
 */
import { readFileSync } from 'node:fs';
import { validate } from '../../packages/contract/schema/validate.mjs';

const { scenarios } = JSON.parse(readFileSync(new URL('./scenarios.json', import.meta.url), 'utf8'));

export function checkScenario(scenario, trace, child) {
  const errors = validate(trace, 'TraceRecord').map((e) => `contract: ${e}`);
  if (errors.length) return errors;
  const exp = scenario.expect;
  const spans = trace.spans;
  const byName = (name) => spans.filter((s) => s.name === name);
  const ids = new Set(spans.map((s) => s.id));

  if (spans[0]?.parentId !== null) errors.push('the root span must come first with parentId null');
  for (const s of spans) if (s.parentId !== null && !ids.has(s.parentId)) errors.push(`span ${s.name} has unknown parentId ${s.parentId}`);
  if (new Set(spans.map((s) => s.id)).size !== spans.length) errors.push('span ids must be unique');

  if (exp.status && trace.status !== exp.status) errors.push(`trace status ${trace.status}, expected ${exp.status}`);
  if (exp.maxSpans && spans.length > exp.maxSpans)
    errors.push(`${spans.length} spans, expected at most ${exp.maxSpans} (repeated calls must be collapsed)`);

  if (exp.chain) {
    let parent;
    for (const name of exp.chain) {
      const span = byName(name).find((s) => !parent || s.parentId === parent.id);
      if (!span) {
        errors.push(`missing ${name}${parent ? ` as a child of ${parent.name}` : ''}`);
        break;
      }
      parent = span;
    }
  }

  for (const [name, e] of Object.entries(exp.spans ?? {})) {
    const span = byName(name)[0];
    if (!span) {
      errors.push(`missing span ${name}`);
      continue;
    }
    if (e.kind && span.kind !== e.kind) errors.push(`${name}: kind ${span.kind}, expected ${e.kind}`);
    if (e.status && span.status !== e.status) errors.push(`${name}: status ${span.status}, expected ${e.status}`);
    if (e.args !== undefined && span.args?.length !== e.args)
      errors.push(`${name}: ${span.args?.length ?? 0} args captured, expected ${e.args}`);
    if (e.result && !('result' in span)) errors.push(`${name}: result not captured`);
    if (e.errorName && span.error?.name !== e.errorName) errors.push(`${name}: error.name ${span.error?.name}, expected ${e.errorName}`);
    if (e.errorMessage && span.error?.message !== e.errorMessage)
      errors.push(`${name}: error.message ${span.error?.message}, expected ${e.errorMessage}`);
    if (e.log && !span.logs?.some((l) => l.message.includes(e.log))) errors.push(`${name}: no log line containing "${e.log}"`);
  }

  for (const [name, expected] of Object.entries(exp.calls ?? {})) {
    const total = byName(name).reduce((n, s) => n + (s.collapsed ? s.collapsed.count : 1), 0);
    if (total !== expected) errors.push(`${name}: ${total} calls accounted for (individual + collapsed.count), expected ${expected}`);
  }
  if (exp.collapsed && !byName(exp.collapsed).some((s) => s.collapsed)) errors.push(`${exp.collapsed}: no span with "collapsed" set`);

  // cross-service: the caller's outgoing-call span and the callee's trace point at each other
  const out = spans.filter((s) => s.outbound);
  if (exp.outbound) {
    const o = exp.outbound;
    if (o.count !== undefined && out.length !== o.count) errors.push(`${out.length} outgoing-call spans, expected ${o.count}`);
    const span = out[0];
    if (span) {
      if (span.kind !== 'http') errors.push(`outgoing call: kind ${span.kind}, expected http`);
      for (const k of ['method', 'statusCode', 'propagated'])
        if (o[k] !== undefined && span.outbound[k] !== o[k]) errors.push(`outbound.${k} ${span.outbound[k]}, expected ${o[k]}`);
      if (o.childTraceId && child && span.outbound.childTraceId !== child.id)
        errors.push(`outbound.childTraceId ${span.outbound.childTraceId}, expected the callee's trace id ${child.id}`);
    }
  }
  if (exp.child) {
    if (!child) errors.push(`no callee trace (expected under "${scenario.name}.child")`);
    else {
      errors.push(...validate(child, 'TraceRecord').map((e) => `callee contract: ${e}`));
      if (exp.child.parentLinked) {
        if (child.parent?.traceId !== trace.id) errors.push(`callee parent.traceId ${child.parent?.traceId}, expected ${trace.id}`);
        if (!out.some((s) => s.id === child.parent?.spanId))
          errors.push(`callee parent.spanId ${child.parent?.spanId} is not an outgoing-call span of the caller`);
      }
    }
  }
  return errors;
}

function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('usage: check.mjs <results.json | ->');
    process.exit(2);
  }
  const results = JSON.parse(readFileSync(file === '-' ? 0 : file, 'utf8'));
  let failed = 0;
  for (const scenario of scenarios) {
    const trace = results[scenario.name];
    const errors = trace ? checkScenario(scenario, trace, results[`${scenario.name}.child`]) : ['no trace produced'];
    if (errors.length) failed++;
    console.log(`${errors.length ? '✗' : '✓'} ${scenario.name}`);
    for (const e of errors) console.log(`    ${e}`);
  }
  console.log(failed ? `\n${failed} of ${scenarios.length} scenarios failed` : `\nall ${scenarios.length} scenarios passed`);
  process.exit(failed ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
