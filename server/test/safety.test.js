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

// LAB_ALLOWED_HOSTS: the lab-proxy sends Host: <this app's name> and, for API calls, X-Forwarded-Host/-Proto; the browser's Origin is the proxy's.
const LAB = 'ntnp.lab.example';
const PROXY = 'proxy.example:8443';
const via = (over = {}) => ({ origin: `https://${PROXY}`, 'x-forwarded-host': PROXY, 'x-forwarded-proto': 'https', ...over });
const runBody = { scenario: 'fee-waiver', profile: 'ungoverned' };
const dropUndefined = (h) => Object.fromEntries(Object.entries(h).filter(([, v]) => v !== undefined));

test('LAB_ALLOWED_HOSTS: names are trimmed and lower-cased, unset is empty, an invalid name throws', () => {
  assert.deepEqual([...safety.allowedHostsFrom({ LAB_ALLOWED_HOSTS: ` ${LAB.toUpperCase()}, second.lab.example ` })].sort(), [LAB, 'second.lab.example']);
  assert.equal(safety.allowedHostsFrom({}).size, 0);
  assert.equal(safety.allowedHostsFrom({ LAB_ALLOWED_HOSTS: '' }).size, 0);
  for (const bad of ['good.example,bad name', 'http://x.example', 'x.example:8443', '-x.example', 'x..example', 'a_b.example', 'x.example/']) {
    assert.throws(() => safety.allowedHostsFrom({ LAB_ALLOWED_HOSTS: bad }), /LAB_ALLOWED_HOSTS: not a host name/, bad);
  }
});

test('Host guard with LAB_ALLOWED_HOSTS: listed names pass with or without a port in any case, loopback passes, every other name is 421', async (t) => {
  const srv = await startTestServer({ env: { LAB_ALLOWED_HOSTS: ` ${LAB.toUpperCase()}, second.lab.example ` } });
  t.after(() => srv.close());
  for (const host of [LAB, `${LAB}:5350`, 'NTNP.Lab.Example:8443', 'second.lab.example', 'localhost', '127.0.0.1:5350']) assert.equal((await request(srv.port, 'GET', '/api/health', { host })).status, 200, host);
  for (const host of [`${LAB}.evil.example`, `evil.${LAB}`, `x${LAB}`, 'lab.example', 'third.lab.example', `${LAB}:abc`, `${LAB}:99999999`, `${LAB}@evil.example`, '0.0.0.0']) {
    assert.equal((await request(srv.port, 'GET', '/api/health', { host })).status, 421, host);
  }
});

test('Host guard with LAB_ALLOWED_HOSTS unset: loopback only', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());
  assert.equal((await request(srv.port, 'GET', '/api/health', { host: LAB })).status, 421);
  assert.equal((await request(srv.port, 'GET', '/api/health', { host: '127.0.0.1' })).status, 200);
});

test('an invalid LAB_ALLOWED_HOSTS refuses to start and leaves nothing running', async () => {
  // Count the timers and listeners started while the bad config is refused: there must be none.
  const started = [];
  const realInterval = globalThis.setInterval;
  const realListen = net.Server.prototype.listen;
  globalThis.setInterval = (...a) => { started.push('timer'); return realInterval(...a); };
  const servers = [];
  net.Server.prototype.listen = function listen(...a) { servers.push(this); return realListen.apply(this, a); }; // the helper's own free-port probes close again
  try {
    for (const bad of ['good.example,bad name', 'http://x.example', 'x.example:8443']) {
      await assert.rejects(startTestServer({ env: { LAB_ALLOWED_HOSTS: bad } }), /LAB_ALLOWED_HOSTS: not a host name/, bad);
    }
  } finally { globalThis.setInterval = realInterval; net.Server.prototype.listen = realListen; }
  assert.deepEqual(started, [], 'no timer was started');
  assert.deepEqual(servers.filter((x) => x.listening), [], 'no server is still listening');
});

test('proxied write: accepted for a listed Host with a matching forwarded host and scheme', async (t) => {
  const srv = await startTestServer({ env: { LAB_ALLOWED_HOSTS: LAB } });
  t.after(() => srv.close());
  const post = (headers, host = `${LAB}:5350`) => request(srv.port, 'POST', '/api/runs', { body: runBody, host, headers: dropUndefined(headers) });
  assert.equal((await post(via())).status, 201);
  assert.equal((await post(via(), LAB.toUpperCase())).status, 201, 'Host case does not matter');
  assert.equal((await post(via({ 'x-forwarded-proto': undefined }))).status, 201, 'the scheme defaults to https');
  assert.equal((await post(via({ origin: 'http://proxy.example', 'x-forwarded-host': 'proxy.example', 'x-forwarded-proto': 'http' }))).status, 201);
});

test('proxied write: refused for a foreign origin, a forwarded host mismatch, the wrong scheme, cross-site and a missing forwarded host', async (t) => {
  const srv = await startTestServer({ env: { LAB_ALLOWED_HOSTS: LAB } });
  t.after(() => srv.close());
  const cases = {
    'foreign origin': via({ origin: 'https://evil.example' }),
    'forwarded host mismatch': via({ 'x-forwarded-host': 'other.example:8443' }),
    'https origin, http forwarded': via({ 'x-forwarded-proto': 'http' }),
    'http origin, https default': via({ origin: `http://${PROXY}`, 'x-forwarded-proto': undefined }),
    'unknown scheme': via({ origin: `ftp://${PROXY}`, 'x-forwarded-proto': 'ftp' }),
    'no forwarded host': via({ 'x-forwarded-host': undefined }),
    'cross-site': via({ 'sec-fetch-site': 'cross-site' }),
  };
  for (const [name, headers] of Object.entries(cases)) {
    assert.equal((await request(srv.port, 'POST', '/api/runs', { body: runBody, host: `${LAB}:5350`, headers: dropUndefined(headers) })).status, 403, name);
  }
  assert.equal(srv.runtime.ledger.size(), 0, 'a refused request committed nothing');
});

test('forwarded headers are ignored on a loopback Host, on a Host that is not listed, and when LAB_ALLOWED_HOSTS is unset', async (t) => {
  const listed = await startTestServer({ env: { LAB_ALLOWED_HOSTS: LAB } });
  t.after(() => listed.close());
  for (const host of ['127.0.0.1:5350', 'localhost:5350', '[::1]:5350']) assert.equal((await request(listed.port, 'POST', '/api/runs', { body: runBody, host, headers: via() })).status, 403, host);
  assert.equal((await request(listed.port, 'POST', '/api/runs', { body: runBody, host: 'other.lab.example', headers: via() })).status, 421);
  assert.equal(listed.runtime.ledger.size(), 0);
  const bare = await startTestServer();
  t.after(() => bare.close());
  assert.equal((await request(bare.port, 'POST', '/api/runs', { body: runBody, host: '127.0.0.1:5350', headers: via() })).status, 403);
});
