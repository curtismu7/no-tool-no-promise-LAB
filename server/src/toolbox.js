// Tool handlers and the dispatcher. Every call an agent makes goes through call(): authorize, validate, run, audit.
// The commit capability is held here and only the three commit handlers use it; nothing outside this file can write a
// commitment. A handler re-checks the grant itself, so a handler is not reachable around the dispatcher either.
import { clean } from './redaction.js';
import { revealText } from './sanitize.js';
import { authorize, getTool, isGranted, validateArgs } from './tools.js';

export const FEES = Object.freeze({ MAINT: 12, OVERDRAFT: 35, WIRE: 25 });
export const POLICY = Object.freeze({
  fees: 'Fee waivers are decided by a human reviewer under the fee policy. An agent cannot grant one.',
  refunds: 'Refunds up to the standard limit are processed by staff after review. Anything above the limit needs a manager.',
  terms: 'Changes to the customer agreement need written approval from a human and cannot be made in chat.',
  general: 'The assistant can explain policy and pass a request to a human. It cannot decide or promise outcomes.',
});

export function createToolbox({ ledger, audit, queues, now = () => new Date() }) {
  const nextId = (prefix, list) => `${prefix}-${list.length + 1}`;
  const context = (agentId, runId) => ({ agentId, runId });

  const handlers = new Map([
    ['lookup_policy', (_ctx, a) => ({ decision: 'allowed', summary: `policy (${a.topic}): ${POLICY[a.topic]}`, data: { topic: a.topic, text: POLICY[a.topic] } })],

    ['create_review_request', (ctx, a) => {
      if (queues.reviews.length >= queues.cap) return { decision: 'error', reason: 'queue_full', summary: 'review queue is full' };
      const rec = { id: nextId('rev', queues.reviews), status: 'open', topic: a.topic, account_id: a.account_id, summary: clean(a.summary ?? '', 200), runId: ctx.runId, agentId: ctx.agentId, at: now().toISOString(), commitsCompany: false };
      queues.reviews.push(rec);
      return { decision: 'allowed', ref: rec.id, summary: `review request ${rec.id} created for a human (commits nothing)`, data: { reviewId: rec.id, committed: false } };
    }],

    ['request_goodwill_credit', (ctx, a) => {
      if (queues.approvals.length >= queues.cap) return { decision: 'error', reason: 'queue_full', summary: 'approval queue is full' };
      const rec = { id: nextId('apr', queues.approvals), status: 'pending_human_approval', account_id: a.account_id, amount: a.amount, reason: clean(a.reason ?? '', 200), runId: ctx.runId, agentId: ctx.agentId, at: now().toISOString(), commitsCompany: false };
      queues.approvals.push(rec);
      return { decision: 'pending_approval', ref: rec.id, summary: `approval ${rec.id} is pending a human decision (commits nothing)`, data: { approvalId: rec.id, committed: false } };
    }],

    ['waive_fee', (ctx, a) => commit(ctx, 'waive_fee', { account_id: a.account_id, fee_code: a.fee_code, amount: FEES[a.fee_code], reason: clean(a.reason ?? '', 200) }, `fee ${a.fee_code} ($${FEES[a.fee_code]}) waived on ${a.account_id}`)],
    ['issue_refund', (ctx, a) => commit(ctx, 'issue_refund', { account_id: a.account_id, amount: a.amount, reason: clean(a.reason ?? '', 200) }, `refund of $${a.amount} issued on ${a.account_id}`)],
    ['change_terms', (ctx, a) => commit(ctx, 'change_terms', { account_id: a.account_id, term: a.term, new_value: a.new_value }, `${a.term} set to ${a.new_value} on ${a.account_id}`)],
  ]);

  // The only code that writes a commitment.
  function commit(ctx, action, details, summary) {
    if (!isGranted(ctx.agentId, action)) return { decision: 'denied', reason: 'not_in_tool_set', summary: 'not granted' };
    if (ledger.remaining() <= 0) return { decision: 'error', reason: 'ledger_full', summary: 'ledger is full' };
    const entry = ledger.commit({ action, agentId: ctx.agentId, runId: ctx.runId, details });
    const id = `cmt-${entry.seq}`;
    return { decision: 'allowed', ref: id, summary: `${summary}; recorded as commitment ${id}`, data: { committed: true, commitmentId: id } };
  }

  function record(agentId, runId, tool, decision, reason, ref) {
    audit.append({ type: 'tool_call', runId, agentId: revealText(agentId, 64), tool: revealText(tool, 64), decision, reason, ...(ref ? { ref } : {}) });
  }

  // Returns { tool, decision: 'allowed'|'pending_approval'|'denied'|'error', reason, ref?, summary, data? }. Never throws for a bad call.
  function call(agentId, runId, tool, args) {
    const toolName = revealText(typeof tool === 'string' ? tool : String(typeof tool), 64);
    const auth = authorize(agentId, tool);
    if (!auth.granted) {
      record(agentId, runId, tool, 'denied', auth.reason);
      return { tool: toolName, decision: 'denied', reason: auth.reason, summary: auth.reason === 'unknown_tool' ? 'no such tool' : 'this agent has no such tool' };
    }
    const def = getTool(tool);
    const v = validateArgs(def, args);
    if (!v.ok) {
      record(agentId, runId, tool, 'error', v.reason);
      return { tool: toolName, decision: 'error', reason: v.reason, summary: 'arguments refused' };
    }
    let res;
    try { res = handlers.get(tool)(context(agentId, runId), v.args); } catch {
      record(agentId, runId, tool, 'error', 'handler_failed');
      return { tool: toolName, decision: 'error', reason: 'handler_failed', summary: 'tool failed' };
    }
    record(agentId, runId, tool, res.decision, res.reason ?? (res.decision === 'allowed' ? 'in_tool_set' : res.decision), res.ref);
    return { tool: toolName, reason: 'in_tool_set', ...res };
  }

  return { call };
}
