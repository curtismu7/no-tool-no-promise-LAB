// In-memory state and the run executor. One run = one scripted agent, one tool set, one customer message.
import { createChain, createLedger } from './chain.js';
import { clean } from './redaction.js';
import { revealText } from './sanitize.js';
import { analyze, compose, hasPromiseLanguage, plan } from './planner.js';
import { SCENARIOS, getScenario } from './scenarios.js';
import { createToolbox } from './toolbox.js';
import { agentForProfile, agentTools, assertBoundary, profileNames } from './tools.js';

export const LIMITS = Object.freeze({ runs: 200, ledger: 300, audit: 3000, queue: 200, message: 500 });
const WORDINGS = new Set(['careful', 'loose']);

export class RunError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}

export function createRuntime({ now = () => new Date() } = {}) {
  assertBoundary();
  const audit = createChain({ cap: LIMITS.audit, now });
  const ledger = createLedger({ cap: LIMITS.ledger, now });
  const queues = { reviews: [], approvals: [], cap: LIMITS.queue };
  const runs = [];
  const toolbox = createToolbox({ ledger: { commit: ledger.writer.commit, remaining: ledger.reader.remaining }, audit, queues, now });

  function run({ scenario, profile, wording = 'careful', message } = {}) {
    const scn = getScenario(scenario);
    if (!scn) throw new RunError('unknown_scenario', 'unknown scenario');
    const agentId = agentForProfile(profile);
    if (!agentId) throw new RunError('unknown_profile', `profile must be one of: ${profileNames().join(', ')}`);
    if (typeof wording !== 'string' || !WORDINGS.has(wording)) throw new RunError('bad_wording', 'wording must be careful or loose');
    if (message !== undefined && (typeof message !== 'string' || message.length === 0 || message.length > LIMITS.message)) throw new RunError('bad_message', `message must be 1-${LIMITS.message} characters`);
    if (runs.length >= LIMITS.runs || audit.remaining() < 30 || ledger.reader.remaining() < 5 || queues.reviews.length >= queues.cap - 5 || queues.approvals.length >= queues.cap - 5) {
      throw new RunError('capacity', 'the run store is full; POST /api/reset to clear it', 429);
    }

    const id = `run-${runs.length + 1}`;
    const text = message ?? scn.message;
    const offered = agentTools(agentId);
    audit.append({ type: 'run_started', runId: id, scenario: scn.id, profile, agentId, wording });
    const ledgerBefore = ledger.reader.size();
    const transcript = [{ role: 'customer', text: clean(text, LIMITS.message) }];
    const p = plan(text, offered);
    const steps = [];
    for (const s of p.steps) {
      const r = toolbox.call(agentId, id, s.tool, s.args);
      steps.push({ tool: r.tool, args: JSON.parse(JSON.stringify(s.args, (_k, v) => (typeof v === 'string' ? revealText(v, 64) : v))), decision: r.decision, reason: r.reason, ...(r.ref ? { ref: r.ref } : {}), summary: r.summary });
      transcript.push({ role: 'tool', tool: r.tool, decision: r.decision, text: r.summary });
    }
    const reply = compose({ intent: p.intent, wording, results: steps });
    transcript.push({ role: 'agent', text: reply });
    const commitments = ledger.reader.entries().slice(ledgerBefore).map((e) => `cmt-${e.seq}`);
    const promiseLanguage = hasPromiseLanguage(reply);
    const record = {
      id, scenario: scn.id, profile, agentId, wording, message: transcript[0].text,
      intent: p.intent, injectionSuspected: analyze(text).injection, steps, transcript, reply, commitments,
      analysis: {
        commitmentsMade: commitments.length,
        promiseLanguage,
        unbackedPromise: promiseLanguage && commitments.length === 0,
        note: 'The commitment ledger is what the company is bound to; it is written only by tools. The reply text is what was said. unbackedPromise is a keyword heuristic over the reply, not a guarantee.',
      },
    };
    runs.push(record);
    audit.append({ type: 'run_finished', runId: id, commitments: commitments.length, unbackedPromise: record.analysis.unbackedPromise });
    return structuredClone(record);
  }

  const summaryOf = (r) => ({ id: r.id, scenario: r.scenario, profile: r.profile, commitments: r.commitments.length, unbackedPromise: r.analysis.unbackedPromise });
  return {
    scenarios: () => SCENARIOS.map(({ id, title, message, expect }) => ({ id, title, message, expect })),
    run,
    runs: () => runs.map(summaryOf),
    getRun: (id) => { const r = typeof id === 'string' ? runs.find((x) => x.id === id) : undefined; return r ? structuredClone(r) : undefined; },
    // Read-only views. The ledger writer is not reachable from here.
    ledger: ledger.reader,
    audit: { entries: audit.entries, verify: audit.verify, head: audit.head, size: audit.size, cap: audit.cap },
    queues: () => structuredClone({ reviews: queues.reviews, approvals: queues.approvals }),
    reset() {
      runs.length = 0; queues.reviews.length = 0; queues.approvals.length = 0;
      ledger.reset(); audit.clear();
      audit.append({ type: 'reset' });
    },
    stats: () => ({ runs: runs.length, commitments: ledger.reader.size() }),
  };
}
