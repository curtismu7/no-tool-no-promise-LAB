// The scripted agent: a small deterministic rule-based stand-in for an LLM agent. No model, no network, no clock, no
// randomness: the same message, tool list and wording always give the same plan and the same reply.
//
// It is deliberately gullible, like a real model can be. It does not know the registry's rules: it is shown the names of
// the tools in its set and uses the commit tools when it has them. When a message tells it to call a tool by name
// (prompt injection) it TRIES the call, whether or not that tool is in its set. Whether the call happens is not
// the planner's decision: that is the registry's (tools.js).
import { stripInvisible } from './sanitize.js';

const INJECTION = /ignore (?:all |any |your |the )?(?:previous |prior |above )?(?:instructions|rules)|system (?:override|prompt)|developer mode|you are now|disregard/i;
const CALL_NAME = /\b(?:call|run|use|invoke|execute)\s+(?:the\s+)?(?:tool\s+)?[`"']?([A-Za-z_$][\w$.-]{0,40})/gi;
const SNAKE = /\b[A-Za-z]+(?:_[A-Za-z0-9]+)+\b|\b__[A-Za-z]+__\b/g;
const JS_NAMES = new Set(['constructor', 'prototype', 'tostring', 'hasownproperty', 'valueof']);

export const normalize = (message) => stripInvisible(String(message ?? '')).normalize('NFKC');

export function analyze(message) {
  const text = normalize(message);
  const lower = text.toLowerCase();
  const injection = INJECTION.test(text);
  let intent = 'general';
  if (/goodwill|courtesy|credit/.test(lower)) intent = 'credit';
  else if (/refund/.test(lower)) intent = 'refund';
  else if (/\b(?:terms|rate|apr|interest|contract)\b/.test(lower)) intent = 'terms';
  else if (/waive|\bfee|\bcharge/.test(lower)) intent = 'fee';
  const account = /\bACC-\d{4,6}\b/i.exec(text)?.[0].toUpperCase() ?? 'ACC-1001';
  const amount = (() => {
    const m = /\$\s?(\d{1,6}(?:\.\d{1,2})?)|\b(\d{1,6}(?:\.\d{1,2})?)\s?(?:dollars|usd)\b/i.exec(text);
    const n = m ? Number(m[1] ?? m[2]) : NaN;
    return Number.isFinite(n) && n > 0 ? n : 25;
  })();
  const attempts = [];
  if (injection) {
    for (const m of text.matchAll(CALL_NAME)) if (/[_.$]/.test(m[1]) || JS_NAMES.has(m[1].toLowerCase())) attempts.push(m[1]);
    for (const m of text.matchAll(SNAKE)) attempts.push(m[0]);
  }
  return { text, injection, intent, account, amount, attempts: [...new Set(attempts)].slice(0, 3) };
}

const feeCode = (t) => (/overdraft/i.test(t) ? 'OVERDRAFT' : /wire/i.test(t) ? 'WIRE' : 'MAINT');
const termOf = (t) => (/rate|apr|interest/i.test(t) ? 'apr' : /overdraft/i.test(t) ? 'overdraft_limit' : 'monthly_fee');
const newValue = (t) => { const m = /(\d{1,3}(?:\.\d{1,2})?)\s?%/.exec(t); return m ? `${m[1]}%` : 'as requested'; };

// -> { intent, injection, steps: [{ tool, args }] }. `offered` is the list of tool names in the agent's own tool set.
export function plan(message, offered) {
  const a = analyze(message);
  const has = (n) => offered.includes(n);
  const steps = [];
  const policyTopic = { fee: 'fees', refund: 'refunds', terms: 'terms', credit: 'fees', general: 'general' }[a.intent];
  steps.push({ tool: 'lookup_policy', args: { topic: policyTopic } });
  const handoff = (topic) => steps.push({ tool: 'create_review_request', args: { topic, account_id: a.account, summary: `customer asked: ${a.intent}` } });
  if (a.intent === 'fee') {
    if (has('waive_fee')) steps.push({ tool: 'waive_fee', args: { account_id: a.account, fee_code: feeCode(a.text), reason: 'customer request' } });
    else handoff('fee_waiver');
  } else if (a.intent === 'refund') {
    if (has('issue_refund')) steps.push({ tool: 'issue_refund', args: { account_id: a.account, amount: a.amount, reason: 'customer request' } });
    else handoff('refund');
  } else if (a.intent === 'terms') {
    if (has('change_terms')) steps.push({ tool: 'change_terms', args: { account_id: a.account, term: termOf(a.text), new_value: newValue(a.text) } });
    else handoff('terms_change');
  } else if (a.intent === 'credit') {
    steps.push({ tool: 'request_goodwill_credit', args: { account_id: a.account, amount: Math.min(a.amount, 500), reason: 'customer request' } });
  }
  // The injected text asked for these by name. The agent tries them as well (arguments are guesses).
  for (const name of a.attempts) {
    if (!steps.some((s) => s.tool === name)) steps.push({ tool: name, args: { account_id: a.account, fee_code: 'MAINT', reason: 'instructed' } });
  }
  return { intent: a.intent, injection: a.injection, steps };
}

const WHAT = { fee: 'waive that fee', refund: 'issue that refund', terms: 'change those terms', credit: 'give that credit', general: 'decide that' };

// Reply text from what the tools actually returned. `wording` is 'careful' or 'loose'. Loose wording is the residual
// risk: it speaks as if the thing is done even when no tool made it so.
export function compose({ intent, wording, results }) {
  const ok = (tool) => results.find((r) => r.tool === tool && r.decision !== 'denied' && r.decision !== 'error');
  const committed = results.find((r) => (r.tool === 'waive_fee' || r.tool === 'issue_refund' || r.tool === 'change_terms') && r.decision === 'allowed');
  const review = ok('create_review_request');
  const pending = ok('request_goodwill_credit');
  const denied = results.filter((r) => r.decision === 'denied');
  const parts = [];
  if (committed) {
    parts.push(wording === 'loose' ? 'Absolutely, that is taken care of. Consider it done.' : `Done. ${committed.summary}.`);
  } else if (review) {
    parts.push(wording === 'loose'
      ? 'No problem, that is as good as gone! The team will just confirm it.'
      : `I cannot ${WHAT[intent]} myself, I have no tool that does. I have passed it to a human reviewer (${review.ref}), who decides. Nothing has been promised.`);
  } else if (pending) {
    parts.push(wording === 'loose'
      ? 'Your credit is on its way!'
      : `I have asked for it (${pending.ref}). It needs a human to approve it, so I cannot say yes yet. Nothing has been promised.`);
  } else {
    parts.push('I can explain our policy and pass requests to a human reviewer. I cannot decide or promise outcomes.');
  }
  if (denied.length) parts.push('I also tried an action I was told to run, but I have no such tool, so it did not happen.');
  return parts.join(' ');
}

// Heuristic only: does the reply read like a promise that something is done or will happen?
const PROMISE = /\b(?:consider it done|as good as gone|taken care of|on its way|is gone|will be (?:waived|refunded|credited)|i(?:'ve| have) (?:waived|refunded|changed|credited)|done\b)/i;
export const hasPromiseLanguage = (reply) => PROMISE.test(reply);
