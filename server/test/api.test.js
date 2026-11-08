import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc, request, startTestServer } from './helpers.js';

const { SCENARIOS } = await loadSrc('scenarios.js');
const { createHealth } = await loadSrc('health.js');
const { allPassed, runChecks } = await loadSrc('doctor.js');

let srv; let port;
test.before(async () => { srv = await startTestServer(); port = srv.port; });
test.after(() => srv.close());

const get = (p, o) => request(port, 'GET', p, o);
const post = (p, body) => request(port, 'POST', p, { body });

test('GET /api/health is demo-health/1', async () => {
  const r = await get('/api/health');
  assert.equal(r.status, 200);
  assert.match(r.headers['content-type'], /json/);
  assert.equal(r.headers['cache-control'], 'no-store');
  assert.equal(r.json.schema, 'demo-health/1');
  assert.equal(r.json.state, 'ready');
  assert.equal(r.json.runtime, 'offline');
  assert.deepEqual(Object.keys(r.json.demo).sort(), ['id', 'name', 'version']);
  assert.equal(r.json.demo.id, 'no-tool-no-promise');
  assert.ok(r.raw.length < 4096);
  assert.equal((await post('/api/health', {})).status, 405);
});

test('health reports broken when a doctor check fails, unknown when the check throws', () => {
  const broken = createHealth({ runChecks: () => [{ id: 'x', level: 'fail', detail: 'd' }], intervalMs: 1e9 });
  const thrown = createHealth({ runChecks: () => { throw new Error('x'); }, intervalMs: 1e9 });
  const out = (h) => { let body; h.router.handle({ method: 'GET', url: '/', headers: {} }, { set() {}, json(b) { body = b; } }, () => {}); h.stop(); return body; };
  assert.equal(out(broken).state, 'broken');
  assert.equal(out(thrown).state, 'unknown');
  assert.equal(allPassed(runChecks({ env: {} })), true);
});

test('GET /api/scenarios lists the five scenarios with what each tool set should do', async () => {
  const r = await get('/api/scenarios');
  assert.deepEqual(r.json.scenarios.map((s) => s.id), ['fee-waiver', 'refund-over-limit', 'change-of-terms', 'prompt-injected', 'needs-approval']);
  assert.equal(r.json.scenarios.length, SCENARIOS.length);
  for (const s of r.json.scenarios) assert.equal(s.expect.governed.commitments, 0);
});

test('GET /api/agents is the per-agent registry, deny by default', async () => {
  const r = (await get('/api/agents')).json;
  assert.equal(r.denyByDefault, true);
  const gov = r.agents.find((a) => a.profile === 'governed');
  const ung = r.agents.find((a) => a.profile === 'ungoverned');
  assert.deepEqual(gov.tools.map((t) => t.name), ['lookup_policy', 'create_review_request', 'request_goodwill_credit']);
  assert.deepEqual(gov.denied, ['waive_fee', 'issue_refund', 'change_terms']);
  assert.equal(gov.canCommitCompany, false);
  assert.equal(ung.canCommitCompany, true);
  assert.equal(r.tools.length, 6);
});

test('POST /api/runs then GET /api/runs/:id, /api/runs, /api/ledger, /api/audit, /api/audit/verify', async () => {
  await post('/api/reset', {});
  const u = await post('/api/runs', { scenario: 'refund-over-limit', profile: 'ungoverned' });
  assert.equal(u.status, 201);
  assert.equal(u.json.id, 'run-1');
  assert.equal(u.json.steps.find((s) => s.tool === 'issue_refund').decision, 'allowed');
  assert.equal(u.json.commitments.length, 1);
  const g = await post('/api/runs', { scenario: 'refund-over-limit', profile: 'governed' });
  assert.equal(g.json.commitments.length, 0);
  assert.equal(g.json.steps.find((s) => s.tool === 'create_review_request').decision, 'allowed');

  assert.deepEqual((await get('/api/runs/run-1')).json, u.json);
  assert.deepEqual((await get('/api/runs')).json.runs.map((r) => [r.id, r.commitments]), [['run-1', 1], ['run-2', 0]]);

  const ledger = (await get('/api/ledger')).json;
  assert.equal(ledger.count, 1);
  assert.equal(ledger.entries[0].details.amount, 450);
  assert.equal(ledger.entries[0].agentId, 'support-agent-ungoverned');
  assert.equal(ledger.entries[0].runId, 'run-1');

  const audit = (await get('/api/audit')).json;
  assert.ok(audit.entries.some((e) => e.type === 'run_started') && audit.entries.some((e) => e.type === 'tool_call'));
  assert.equal((await get('/api/audit?limit=2')).json.entries.length, 2);
  assert.equal((await get('/api/audit?limit=abc')).status, 200);
  const v = (await get('/api/audit/verify')).json;
  assert.equal(v.audit.ok, true);
  assert.equal(v.ledger.ok, true);
  assert.equal(v.ledger.head, ledger.head);
  assert.equal(v.audit.head, audit.head);
});

test('input validation on POST /api/runs', async () => {
  assert.equal((await post('/api/runs', {})).status, 400);
  assert.equal((await post('/api/runs', { scenario: 'nope', profile: 'governed' })).json.error, 'unknown_scenario');
  assert.equal((await post('/api/runs', { scenario: 'fee-waiver', profile: 'x' })).json.error, 'unknown_profile');
  assert.equal((await post('/api/runs', { scenario: 'fee-waiver', profile: 'governed', wording: 'shouty' })).json.error, 'bad_wording');
  assert.equal((await post('/api/runs', { scenario: 'fee-waiver', profile: 'governed', message: '' })).json.error, 'bad_message');
  assert.equal((await post('/api/runs', { scenario: 'fee-waiver', profile: 'governed', message: 'x'.repeat(501) })).json.error, 'bad_message');
  assert.equal((await post('/api/runs', { scenario: 'fee-waiver', profile: 'governed', message: 5 })).json.error, 'bad_message');
  assert.equal((await get('/api/runs/nope')).status, 404);
  assert.equal((await get('/api/nope')).status, 404);
  assert.equal((await get('/nope')).status, 404);
});

test('POST /api/reset clears runs, ledger, queues and audit, takes no parameters, and the chain restarts', async () => {
  await post('/api/runs', { scenario: 'fee-waiver', profile: 'ungoverned' });
  assert.equal((await post('/api/reset', { x: 1 })).status, 400);
  assert.equal((await post('/api/reset', {})).status, 200);
  assert.equal((await get('/api/ledger')).json.count, 0);
  assert.deepEqual((await get('/api/runs')).json.runs, []);
  assert.deepEqual((await get('/api/reviews')).json, { reviews: [], approvals: [] });
  const audit = (await get('/api/audit')).json;
  assert.deepEqual(audit.entries.map((e) => e.type), ['reset']);
  assert.equal((await get('/api/audit/verify')).json.audit.ok, true);
});

test('GET /api/reviews shows review requests and pending approvals, which commit nothing', async () => {
  await post('/api/reset', {});
  await post('/api/runs', { scenario: 'fee-waiver', profile: 'governed' });
  await post('/api/runs', { scenario: 'needs-approval', profile: 'governed' });
  const q = (await get('/api/reviews')).json;
  assert.equal(q.reviews.length, 1); assert.equal(q.reviews[0].commitsCompany, false);
  assert.equal(q.approvals.length, 1); assert.equal(q.approvals[0].status, 'pending_human_approval');
  assert.equal((await get('/api/ledger')).json.count, 0);
});

test('GET /api/shelf returns SHELF_URL (slash trimmed) with no web build; POST is not 200', async () => {
  const s = await startTestServer({ env: { SHELF_URL: 'https://shelf.example:8443/', HOME: '/nonexistent' }, webDist: null });
  try {
    const r = await request(s.port, 'GET', '/api/shelf');
    assert.equal(r.status, 200);
    assert.deepEqual(r.json, { shelfUrl: 'https://shelf.example:8443' });
    assert.notEqual((await request(s.port, 'POST', '/api/shelf', { body: {} })).status, 200);
  } finally { await s.close(); }
});
