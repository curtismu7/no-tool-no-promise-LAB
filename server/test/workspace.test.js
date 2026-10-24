// Per-visitor workspaces (rule 13, se-mock only): one workspace can never read or change another's state; hostile ids
// are refused; the registry is capped and idle workspaces expire. Local mode ignores the header entirely.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { loadSrc, request } from './helpers.js';

const { createApp } = await loadSrc('app.js');
const { createHealth } = await loadSrc('health.js');
const ws = await loadSrc('workspaces.js');
const { createRuntime } = await loadSrc('runtime.js');

const WS = 'x-workspace-id';

// Serves createApp() on a free loopback port and returns { port, close }. The health timer is stopped on close.
async function serve(opts) {
  const health = createHealth({ intervalMs: 1e9, env: {} });
  const server = http.createServer(createApp({ webDist: null, health, runtime: createRuntime(), ...opts }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { port: server.address().port, close: () => new Promise((r) => { health.stop(); server.closeAllConnections?.(); server.close(r); }) };
}

const runBody = { scenario: 'fee-waiver', profile: 'ungoverned' };

test('a workspace id is accepted only in the strict charset and length; repeated or non-string values are refused', () => {
  assert.equal(ws.resolveWorkspaceId(undefined), 'default');
  for (const ok of ['a', '0', 'ws-1', 'a'.repeat(32), 'v-2-x']) assert.equal(ws.resolveWorkspaceId(ok), ok, ok);
  for (const bad of ['', 'A', '-a', '_a', 'a'.repeat(33), 'a b', 'a/b', '../x', 'a,b', 'a\nb', 'ü', 'a.b', 'a;b', '%2e%2e', '<x>', ['a', 'b'], null, 42, {}]) {
    assert.equal(ws.resolveWorkspaceId(bad), null, JSON.stringify(bad));
  }
});

test('the registry keeps one runtime per id and hands back the same one', () => {
  const made = [];
  const reg = ws.createWorkspaces({ defaultRuntime: 'D', create: () => { const r = { n: made.length }; made.push(r); return r; } });
  const a = reg.get('a');
  assert.equal(reg.get('a'), a);
  assert.notEqual(reg.get('b'), a);
  assert.equal(reg.get(), 'D', 'no id is the default runtime');
  assert.equal(made.length, 2);
});

test('the registry is capped: past the cap the least recently used non-default workspace is dropped; default stays', () => {
  const reg = ws.createWorkspaces({ defaultRuntime: 'D', create: () => ({}), max: 3 });
  reg.get('a'); reg.get('b');
  reg.get('a'); // a is now the most recently used, so b is the least
  reg.get('c');
  assert.deepEqual(reg.ids(), ['default', 'a', 'c'], 'b was evicted');
  for (let i = 0; i < 20; i += 1) reg.get(`w${i}`);
  assert.equal(reg.size(), 3);
  assert.ok(reg.ids().includes('default'), 'the default workspace is never evicted');
});

test('idle workspaces expire after the TTL; the default is not expired by time', () => {
  let t = 0;
  const reg = ws.createWorkspaces({ defaultRuntime: 'D', create: () => ({}), ttlMs: 1000, now: () => t });
  reg.get('a');
  t = 500; reg.get('b');
  t = 1200; // a is 1200 ms idle (expired), b is 700 ms idle (kept)
  reg.get('c');
  assert.deepEqual(reg.ids().sort(), ['b', 'c', 'default']);
  t = 10_000_000;
  reg.get('d');
  assert.deepEqual(reg.ids().sort(), ['d', 'default']);
});

test('se-mock: two workspaces cannot see or change each other (runs, ledger, audit, reset)', async (t) => {
  const srv = await serve({ mode: 'se-mock' });
  t.after(() => srv.close());
  const as = (id, method, path, body) => request(srv.port, method, path, { body, headers: { [WS]: id } });

  const made = await as('visitor-a', 'POST', '/api/runs', runBody);
  assert.equal(made.status, 201);
  assert.equal(made.json.id, 'run-1');
  assert.equal((await as('visitor-a', 'GET', '/api/runs')).json.runs.length, 1);

  // B sees nothing of A
  assert.deepEqual((await as('visitor-b', 'GET', '/api/runs')).json.runs, []);
  assert.equal((await as('visitor-b', 'GET', '/api/runs/run-1')).status, 404, 'A\'s run is not readable by id from B');
  assert.equal((await as('visitor-b', 'GET', '/api/ledger')).json.count, 0);

  // B's own run is B's alone, and A is unchanged by it
  const bRun = await as('visitor-b', 'POST', '/api/runs', { scenario: 'refund-over-limit', profile: 'ungoverned' });
  assert.equal(bRun.status, 201);
  assert.equal((await as('visitor-a', 'GET', '/api/runs')).json.runs.length, 1, 'A still has one run');
  assert.equal((await as('visitor-a', 'GET', '/api/ledger')).json.count, 1, 'A\'s ledger holds only A\'s commitment');
  assert.equal((await as('visitor-b', 'GET', '/api/ledger')).json.count, 1);

  // B's Reset clears B and not A
  const auditA = (await as('visitor-a', 'GET', '/api/audit')).json.count;
  assert.equal((await as('visitor-b', 'POST', '/api/reset', {})).status, 200);
  assert.deepEqual((await as('visitor-b', 'GET', '/api/runs')).json.runs, []);
  assert.equal((await as('visitor-a', 'GET', '/api/runs')).json.runs.length, 1, 'A survives B\'s reset');
  assert.equal((await as('visitor-a', 'GET', '/api/audit/verify')).json.audit.ok, true);
  assert.equal((await as('visitor-a', 'GET', '/api/audit')).json.count, auditA, 'B\'s reset did not touch A\'s audit trail');
  assert.equal((await as('visitor-a', 'GET', '/api/runs/run-1')).status, 200);
});

test('se-mock: a missing header is the default workspace; a hostile or malformed id is refused and creates nothing', async (t) => {
  const srv = await serve({ mode: 'se-mock' });
  t.after(() => srv.close());
  const plain = await request(srv.port, 'POST', '/api/runs', { body: runBody });
  assert.equal(plain.status, 201);
  assert.equal((await request(srv.port, 'GET', '/api/runs')).json.runs.length, 1, 'no header reads the default workspace');
  for (const id of ['Bad', '../../etc', 'a'.repeat(33), 'x y', 'a%2Fb', '-lead', '<script>', 'default/../x']) {
    const r = await request(srv.port, 'GET', '/api/runs', { headers: { [WS]: id } });
    assert.equal(r.status, 400, id);
    assert.equal(r.json.error, 'bad_workspace', id);
  }
  // refused ids did not change the default workspace
  assert.equal((await request(srv.port, 'GET', '/api/runs')).json.runs.length, 1);
  // a repeated header is refused too
  const dup = await new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: srv.port, path: '/api/runs', headers: { [WS]: ['a', 'b'] } }, (res) => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject); req.end();
  });
  assert.equal(dup, 400);
});

test('se-mock: the cap evicts the least recently used workspace over HTTP, and the evicted visitor starts empty', async (t) => {
  const srv = await serve({ mode: 'se-mock', workspaceOptions: { max: 2 } });
  t.after(() => srv.close());
  const as = (id, method, path, body) => request(srv.port, method, path, { body, headers: { [WS]: id } });
  assert.equal((await as('first', 'POST', '/api/runs', runBody)).status, 201);
  assert.equal((await as('first', 'GET', '/api/runs')).json.runs.length, 1);
  assert.equal((await as('second', 'POST', '/api/runs', runBody)).status, 201, 'a new workspace evicts first');
  assert.deepEqual((await as('first', 'GET', '/api/runs')).json.runs, [], 'first was evicted and starts empty');
});

test('local: the header is ignored entirely (behaviour unchanged): one process-wide state, no 400 for any value', async (t) => {
  const srv = await serve({ mode: 'local' });
  t.after(() => srv.close());
  assert.equal((await request(srv.port, 'POST', '/api/runs', { body: runBody, headers: { [WS]: 'visitor-a' } })).status, 201);
  assert.equal((await request(srv.port, 'GET', '/api/runs', { headers: { [WS]: 'visitor-b' } })).json.runs.length, 1, 'visitor-b sees the one shared run');
  assert.equal((await request(srv.port, 'GET', '/api/runs', { headers: { [WS]: 'Bad Id' } })).status, 200);
});

test('se-mock: reads from unknown ids never allocate, so a flood of them cannot evict a visitor', async (t) => {
  const srv = await serve({ mode: 'se-mock', workspaceOptions: { max: 2 } });
  t.after(() => srv.close());
  const as = (id, method, path, body) => request(srv.port, method, path, { body, headers: { [WS]: id } });
  assert.equal((await as('victim', 'POST', '/api/runs', runBody)).status, 201);
  for (let i = 0; i < 20; i += 1) {
    assert.equal((await as(`flood-${i}`, 'GET', '/api/runs')).status, 200);
    assert.equal((await as(`flood-${i}`, 'POST', '/api/reset', {})).status, 200);
    assert.equal((await as(`flood-${i}`, 'GET', '/api/nope')).status, 404);
  }
  assert.equal((await as('victim', 'GET', '/api/runs')).json.runs.length, 1, 'the victim keeps its run');
  assert.deepEqual((await as('flood-0', 'GET', '/api/runs')).json.runs, [], 'an unknown id reads an empty workspace');
});
