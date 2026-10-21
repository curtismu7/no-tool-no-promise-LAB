import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { SRC_DIR, loadSrc, request, startTestServer } from './helpers.js';
import { guardNetwork } from './netguard.js';

const safety = await loadSrc('safety.js');
const { allPassed, runChecks } = await loadSrc('doctor.js');
const { SCENARIOS } = await loadSrc('scenarios.js');

test('loopback helpers and the port range 5350-5399', () => {
  for (const h of ['127.0.0.1', 'localhost', '::1', '[::1]', '127.1.2.3']) assert.equal(safety.isLoopbackHost(h), true, h);
  for (const h of ['0.0.0.0', '192.168.1.1', 'example.com', '127.0.0.1.evil.com']) assert.equal(safety.isLoopbackHost(h), false, h);
  assert.equal(safety.portInRange(5350) && safety.portInRange(5399) && safety.portInRange(5370), true);
  for (const p of [5349, 5400, 5300, 8080, 5173, 3900, 4000, 4400, 4510, 18080, NaN, 5350.5]) assert.equal(safety.portInRange(p), false, String(p));
  assert.equal(safety.SERVER_PORT, 5350);
  assert.equal(allPassed(runChecks({ env: { NTNP_PORT: '8080' } })), false);
  assert.equal(allPassed(runChecks({ env: { NTNP_PORT: '5400' } })), false);
  assert.equal(allPassed(runChecks({ env: {} })), true);
});

test('binds loopback by default; any other address needs NTNP_BIND', () => {
  assert.equal(safety.bindHost({}), '127.0.0.1');
  assert.throws(() => safety.assertBindAllowed('0.0.0.0', {}), /loopback only/);
  assert.equal(safety.assertBindAllowed('0.0.0.0', { NTNP_BIND: '0.0.0.0' }), '0.0.0.0');
  assert.equal(allPassed(runChecks({ env: { NTNP_BIND: '0.0.0.0' } })), true);
});

test('a started server listens on loopback only', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());
  assert.equal((await request(srv.port, 'GET', '/api/health')).status, 200);
  assert.ok(srv.port >= 5380 && srv.port <= 5399);
  const external = Object.values(os.networkInterfaces()).flat().find((i) => i && !i.internal && i.family === 'IPv4');
  if (external) {
    const refused = await new Promise((resolve) => { const s = net.connect({ host: external.address, port: srv.port }); s.once('connect', () => { s.destroy(); resolve(false); }); s.once('error', () => resolve(true)); });
    assert.equal(refused, true, 'not reachable on the LAN address');
  }
});

test('the guard itself works', async () => {
  const guard = guardNetwork();
  try {
    await assert.rejects(() => fetch('http://example.com/'), /network blocked/);
    assert.deepEqual(guard.attempts, ['fetch:example.com']);
  } finally { guard.restore(); }
});

test('every scenario, both tool sets, both wordings: zero non-loopback connections, DNS lookups or fetches', async (t) => {
  const guard = guardNetwork();
  let srv;
  try {
    srv = await startTestServer();
    for (const s of SCENARIOS) for (const profile of ['governed', 'ungoverned']) for (const wording of ['careful', 'loose']) {
      assert.equal((await request(srv.port, 'POST', '/api/runs', { body: { scenario: s.id, profile, wording } })).status, 201);
    }
    for (const p of ['/api/health', '/api/agents', '/api/scenarios', '/api/ledger', '/api/audit', '/api/audit/verify', '/api/reviews', '/api/runs']) assert.equal((await request(srv.port, 'GET', p)).status, 200, p);
    assert.deepEqual(guard.attempts, []);
  } finally { guard.restore(); await srv?.close(); }
});

test('source scan: the server code has no way to open a network connection or start a process', () => {
  const forbidden = /node:(?:http|https|http2|net|tls|dgram|dns|child_process|cluster|worker_threads)\b|require\(|\bfetch\(|XMLHttpRequest|WebSocket|\beval\(|new Function\(/;
  const importsOk = new Set(['express', 'node:crypto', 'node:fs', 'node:url', 'node:path']);
  for (const f of fs.readdirSync(SRC_DIR).filter((x) => x.endsWith('.js'))) {
    const text = fs.readFileSync(path.join(SRC_DIR, f), 'utf8');
    assert.doesNotMatch(text, forbidden, f);
    for (const m of text.matchAll(/from '([^'.][^']*)'/g)) assert.ok(importsOk.has(m[1]), `${f} imports ${m[1]}`);
    if (!['app.js', 'index.js'].includes(f)) assert.doesNotMatch(text, /\.listen\(/, f);
  }
});

test('Host guard: a missing, malformed or non-loopback Host header is refused (421)', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());
  for (const host of ['evil.example', 'evil.example:5350', '127.0.0.1.evil.com', '127.999.999.999', '[::1]junk', '0.0.0.0', 'localhost.evil.com']) {
    assert.equal((await request(srv.port, 'GET', '/api/health', { host })).status, 421, host);
  }
  assert.equal((await request(srv.port, 'GET', '/api/health', { host: `localhost:${srv.port}` })).status, 200);
});

test('CSRF: a cross-origin or cross-site POST is refused; a body must be JSON', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());
  const body = { scenario: 'fee-waiver', profile: 'ungoverned' };
  for (const headers of [{ origin: 'http://evil.example' }, { origin: 'null' }, { origin: 'http://127.0.0.1:1' }, { origin: `http://127.0.0.1:${srv.port}`, 'sec-fetch-site': 'cross-site' }, { origin: `http://user@127.0.0.1:${srv.port}` }, { 'sec-fetch-site': 'cross-site' }]) {
    const r = await request(srv.port, 'POST', '/api/runs', { body, headers });
    assert.equal(r.status, 403, JSON.stringify(headers));
  }
  assert.equal((await request(srv.port, 'POST', '/api/reset', { headers: { origin: 'http://evil.example' } })).status, 403);
  assert.equal(srv.runtime.ledger.size(), 0, 'a refused request committed nothing');
  assert.equal((await request(srv.port, 'POST', '/api/runs', { body: 'scenario=fee-waiver', headers: { 'content-type': 'text/plain' } })).status, 415);
  assert.equal((await request(srv.port, 'POST', '/api/runs', { body, headers: { origin: `http://127.0.0.1:${srv.port}` } })).status, 201);
  assert.equal((await request(srv.port, 'POST', '/api/runs', { body, headers: { 'sec-fetch-site': 'same-origin' } })).status, 201);
});

test('credentials are refused, not ignored (also on /api/health)', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());
  for (const h of ['authorization', 'proxy-authorization', 'x-api-key']) {
    for (const [m, p] of [['GET', '/api/health'], ['GET', '/api/agents'], ['POST', '/api/runs']]) {
      const r = await request(srv.port, m, p, { headers: { [h]: 'x' }, body: m === 'POST' ? { scenario: 'fee-waiver', profile: 'governed' } : undefined });
      assert.equal(r.status, 400, `${h} ${p}`);
      assert.equal(r.json.error, 'credentials_not_accepted');
    }
  }
  assert.equal(srv.runtime.runs().length, 0);
});

test('responses are JSON with nosniff and a locked-down CSP; a 500 never leaks', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());
  const r = await request(srv.port, 'GET', '/api/agents');
  assert.match(r.headers['content-type'], /application\/json/);
  assert.equal(r.headers['x-content-type-options'], 'nosniff');
  assert.equal(r.headers['content-security-policy'], "default-src 'none'");
  assert.equal(r.headers['x-powered-by'], undefined);
  const boom = await startTestServer({ runtime: { scenarios() { throw new Error('secret internal path /Users/x/y at stack'); } } });
  t.after(() => boom.close());
  const e = await request(boom.port, 'GET', '/api/scenarios');
  assert.equal(e.status, 500);
  assert.deepEqual(e.json, { error: 'server_error' });
  assert.doesNotMatch(e.raw, /secret|stack|Users/);
  assert.equal((await request(srv.port, 'GET', '/api/runs/%ZZ')).status, 400);
  assert.equal((await request(srv.port, 'GET', '/api/runs/run-999')).status, 404);
  assert.equal((await request(srv.port, 'GET', '/api/runs/__proto__')).status, 404);
  assert.equal((await request(srv.port, 'POST', '/api/runs', { body: '{"a":' })).status, 400);
  assert.equal((await request(srv.port, 'POST', '/api/runs', { body: `{"message":"${'x'.repeat(6000)}"}` })).status, 413);
});
