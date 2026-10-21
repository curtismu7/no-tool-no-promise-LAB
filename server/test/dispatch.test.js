// The dispatcher (toolbox.call), argument validation, the hash chain's own checks and the capacity guards.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from './helpers.js';

const { createChain, createLedger, hashBody, verifyEntries, GENESIS } = await loadSrc('chain.js');
const { createToolbox } = await loadSrc('toolbox.js');
const { LIMITS, createRuntime, RunError } = await loadSrc('runtime.js');

const GOV = 'support-agent-governed';
const UNG = 'support-agent-ungoverned';

function box({ cap = 5, ledgerOverride } = {}) {
  const ledger = createLedger({ cap: 10 });
  const audit = createChain({ cap: 200 });
  const queues = { reviews: [], approvals: [], cap };
  const tb = createToolbox({ ledger: ledgerOverride ?? { commit: ledger.writer.commit, remaining: ledger.reader.remaining }, audit, queues });
  return { tb, ledger, audit, queues };
}
const lastAudit = (b) => b.audit.entries().at(-1);

// ---- argument validation, through the dispatcher -------------------------------------------------------------------
test('an allowed tool with refused arguments is an error and runs no handler', () => {
  const b = box();
  const r = b.tb.call(UNG, 'run-1', 'waive_fee', { account_id: 'ACC-1001', fee_code: 'NOPE' });
  assert.equal(r.decision, 'error');
  assert.equal(r.reason, 'bad_args');
  assert.equal(b.ledger.reader.size(), 0, 'no commitment');
  assert.equal(lastAudit(b).decision, 'error');
});

test('argument validation: unknown and forged keys, odd prototypes, missing, oversized and out-of-range values', () => {
  const ok = { account_id: 'ACC-1001', fee_code: 'MAINT' };
  const bad = (tool, args, why) => {
    const b = box();
    const r = b.tb.call(UNG, 'run-1', tool, args);
    assert.equal(r.decision, 'error', why);
    assert.equal(r.reason, 'bad_args', why);
    assert.equal(b.ledger.reader.size(), 0, `${why}: no commitment`);
  };
  bad('waive_fee', { ...ok, extra: 1 }, 'unknown key');
  bad('waive_fee', JSON.parse('{"account_id":"ACC-1001","fee_code":"MAINT","__proto__":{"x":1}}'), 'forged __proto__ key');
  bad('waive_fee', JSON.parse('{"account_id":"ACC-1001","fee_code":"MAINT","constructor":1}'), 'constructor key');
  bad('waive_fee', Object.create({ inherited: 1 }, { account_id: { value: 'ACC-1001', enumerable: true }, fee_code: { value: 'MAINT', enumerable: true } }), 'custom prototype');
  bad('waive_fee', [], 'array');
  bad('waive_fee', null, 'null');
  bad('waive_fee', 'ACC-1001', 'string');
  bad('waive_fee', { fee_code: 'MAINT' }, 'required field missing');
  bad('waive_fee', { ...ok, reason: 'x'.repeat(201) }, 'string over its max length');
  bad('waive_fee', { ...ok, account_id: 'acc-1001' }, 'pattern');
  bad('waive_fee', { ...ok, fee_code: 'maint' }, 'enum');
  bad('waive_fee', { ...ok, reason: 5 }, 'wrong type');
  bad('issue_refund', { account_id: 'ACC-1001', amount: 0 }, 'number below min');
  bad('issue_refund', { account_id: 'ACC-1001', amount: 100001 }, 'number above max');
  bad('issue_refund', { account_id: 'ACC-1001', amount: NaN }, 'NaN');
  bad('issue_refund', { account_id: 'ACC-1001', amount: '10' }, 'number as string');
  bad('change_terms', { account_id: 'ACC-1001', term: 'apr', new_value: '<script>' }, 'value pattern');
  // and the same call with good arguments is allowed, so the cases above fail for their stated reason
  const b = box();
  assert.equal(b.tb.call(UNG, 'run-1', 'waive_fee', ok).decision, 'allowed');
});

test('handlers get the validated copy of the arguments, not the caller\'s object (no read-twice trick)', () => {
  const b = box();
  let reads = 0;
  const args = { get topic() { reads += 1; return reads === 1 ? 'fees' : 'constructor'; } };
  const r = b.tb.call(GOV, 'run-1', 'lookup_policy', args);
  assert.equal(r.decision, 'allowed');
  assert.match(r.summary, /policy \(fees\)/);
});

// ---- forged names ---------------------------------------------------------------------------------------------------
test('forged tool and agent names are denied, shown inertly, and audited; the governed agent commits nothing', () => {
  const b = box();
  for (const name of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'waive_fee ', 'WAIVE_FEE', ' waive_fee', 'waive_fee​', 'wai​ve_fee', 'issue_refund', 'change_terms', 'waive_fee', 5, null, {}, ['waive_fee']]) {
    const r = b.tb.call(GOV, 'run-1', name, { account_id: 'ACC-1001', fee_code: 'MAINT' });
    assert.equal(r.decision, 'denied', String(name));
  }
  assert.equal(b.ledger.reader.size(), 0);
  assert.equal(b.queues.reviews.length + b.queues.approvals.length, 0);
});

test('hidden characters in a tool name or agent id are revealed in the result and in the audit entry', () => {
  const b = box();
  const r = b.tb.call(GOV, 'run-1', 'wai​ve', {});
  assert.equal(r.tool, 'wai[U+200B]ve');
  assert.equal(lastAudit(b).tool, 'wai[U+200B]ve');
  b.tb.call('sup‮port', 'run-1', 'lookup_policy', { topic: 'fees' });
  assert.equal(lastAudit(b).agentId, 'sup[U+202E]port');
  assert.equal(lastAudit(b).reason, 'unknown_agent');
});

// ---- queue and ledger capacity inside the dispatcher ----------------------------------------------------------------
test('a full review queue, approval queue or ledger is an error, not an overflow', () => {
  const b = box({ cap: 1 });
  const rev = { topic: 'fee_waiver', account_id: 'ACC-1001' };
  assert.equal(b.tb.call(GOV, 'r', 'create_review_request', rev).decision, 'allowed');
  const r2 = b.tb.call(GOV, 'r', 'create_review_request', rev);
  assert.deepEqual([r2.decision, r2.reason], ['error', 'queue_full']);
  assert.equal(b.queues.reviews.length, 1);
  const apr = { account_id: 'ACC-1001', amount: 10 };
  assert.equal(b.tb.call(GOV, 'r', 'request_goodwill_credit', apr).decision, 'pending_approval');
  const a2 = b.tb.call(GOV, 'r', 'request_goodwill_credit', apr);
  assert.deepEqual([a2.decision, a2.reason], ['error', 'queue_full']);
  assert.equal(b.queues.approvals.length, 1);

  let wrote = 0;
  const full = box({ ledgerOverride: { commit: () => { wrote += 1; return { seq: 0 }; }, remaining: () => 0 } });
  const l = full.tb.call(UNG, 'r', 'waive_fee', { account_id: 'ACC-1001', fee_code: 'MAINT' });
  assert.deepEqual([l.decision, l.reason], ['error', 'ledger_full']);
  assert.equal(wrote, 0, 'the writer was not called');
});

// ---- hash chain -----------------------------------------------------------------------------------------------------
const link = (over) => { const body = { seq: 0, at: 't', prev: GENESIS, ...over }; return { ...body, hash: hashBody(body) }; };

test('verifyEntries: the first entry must link to the genesis value', () => {
  const r = verifyEntries([link({ prev: 'f'.repeat(64) })]);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'bad_link');
  assert.equal(verifyEntries([link({})]).ok, true);
});

test('verifyEntries: a wrong sequence number and a wrong link are each caught on their own, with a valid hash', () => {
  const seq = verifyEntries([link({ seq: 5 })]);
  assert.deepEqual([seq.ok, seq.reason], [false, 'bad_sequence']);
  const e0 = link({});
  const lnk = verifyEntries([e0, link({ seq: 1, prev: 'a'.repeat(64) })]);
  assert.deepEqual([lnk.ok, lnk.reason, lnk.brokenAt], [false, 'bad_link', 1]);
  assert.equal(verifyEntries([e0, link({ seq: 1, prev: e0.hash })]).ok, true);
});

// ---- runtime capacity guards, each reached on its own ---------------------------------------------------------------
const lim = (over) => ({ ...LIMITS, ...over });
function runsUntilRefused(limits, scenario, profile) {
  const rt = createRuntime({ limits });
  let ok = 0;
  for (let i = 0; i < 20; i += 1) {
    try { rt.run({ scenario, profile }); ok += 1; } catch (e) {
      assert.ok(e instanceof RunError);
      assert.deepEqual([e.code, e.status], ['capacity', 429]);
      return ok;
    }
  }
  return ok;
}

test('capacity: each guard refuses with 429 exactly when its own limit is reached', () => {
  assert.equal(runsUntilRefused(lim({ runs: 2 }), 'fee-waiver', 'governed'), 2, 'run count');
  assert.equal(runsUntilRefused(lim({ audit: 35 }), 'fee-waiver', 'governed'), 2, 'audit log room');
  assert.equal(runsUntilRefused(lim({ ledger: 6 }), 'fee-waiver', 'ungoverned'), 2, 'ledger room');
  assert.equal(runsUntilRefused(lim({ queue: 6 }), 'fee-waiver', 'governed'), 1, 'review queue');
  assert.equal(runsUntilRefused(lim({ queue: 6 }), 'needs-approval', 'governed'), 1, 'approval queue');
});

test('capacity: with the real limits the store still refuses before any chain overflows, and a reset frees it', () => {
  const rt = createRuntime();
  let refused = false;
  for (let i = 0; i < LIMITS.runs + 5 && !refused; i += 1) {
    try { rt.run({ scenario: 'fee-waiver', profile: 'governed' }); } catch (e) { assert.equal(e.status, 429); refused = true; }
  }
  assert.equal(refused, true);
  rt.reset();
  assert.equal(rt.run({ scenario: 'fee-waiver', profile: 'governed' }).id, 'run-1');
});

test('getRun returns a copy: changing it does not change the stored run', () => {
  const rt = createRuntime();
  const r = rt.run({ scenario: 'fee-waiver', profile: 'governed' });
  const copy = rt.getRun(r.id);
  copy.reply = 'tampered'; copy.commitments.push('cmt-99');
  assert.notEqual(rt.getRun(r.id).reply, 'tampered');
  assert.deepEqual(rt.getRun(r.id).commitments, []);
  assert.equal(rt.getRun('run-999'), undefined);
});

test('createRuntime refuses to start when the boundary check fails', () => {
  assert.throws(() => createRuntime({ boundaryCheck: () => { throw new Error('tool boundary violated'); } }), /boundary violated/);
});
