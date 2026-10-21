// HTTP-level guards: Host and Origin anchoring, Content-Type and Transfer-Encoding, headers, error mapping, bind and
// doctor behaviour. Each case is one the guard must refuse (or allow) for its own reason.
import test from 'node:test';
import assert from 'node:assert/strict';
import cp from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { SRC_DIR, loadSrc, request, startTestServer } from './helpers.js';

const safety = await loadSrc('safety.js');
const { startHttpServer } = await loadSrc('app.js');
const { createHealth } = await loadSrc('health.js');
const { allPassed, runChecks } = await loadSrc('doctor.js');

test('Host parsing is anchored at both ends: look-alike hosts are refused', () => {
  for (const h of ['evil.localhost', 'xlocalhost', 'evil.com.127.0.0.1:5350', '127.0.0.1.evil.com', 'a127.0.0.1', 'localhost.evil.com', 'x[::1]', 'evil[::1]:5350', 'localhost:5350x', '127.0.0.1:65536', '127.0.0.1:99999', 'localhost:', '', 'localhost evil.com']) {
    assert.equal(safety.parseHost(h), null, h);
  }
  for (const h of ['localhost', 'LOCALHOST:5350', '127.0.0.1:5350', '127.0.0.1:65535', '[::1]:5350', '127.1.2.3']) assert.notEqual(safety.parseHost(h), null, h);
});

test('the server answers 421 to look-alike and over-range Host headers, 200 to loopback ones', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());
  for (const host of ['evil.localhost', 'xlocalhost', `evil.com.127.0.0.1:${srv.port}`, '127.0.0.1:65536']) {
    assert.equal((await request(srv.port, 'GET', '/api/agents', { host })).status, 421, host);
  }
  assert.equal((await request(srv.port, 'GET', '/api/agents', { host: `localhost:${srv.port}` })).status, 200);
});

function raw(port, text) {
  return new Promise((resolve, reject) => {
    const s = net.connect(port, '127.0.0.1');
    let out = '';
    s.on('data', (c) => { out += c; });
    s.on('close', () => resolve(out));
    s.on('error', reject);
    s.on('connect', () => s.write(text));
    setTimeout(() => s.destroy(), 1500);
  });
}

test('Origin must be an exact http loopback origin equal to the Host; Content-Type is anchored; chunked bodies need JSON too', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());
  const p = srv.port;
  const body = { scenario: 'fee-waiver', profile: 'governed' };
  const post = (headers) => request(p, 'POST', '/api/runs', { body, headers });
  assert.equal((await post({ origin: `http://127.0.0.1:${p}` })).status, 201, 'the exact origin is allowed');
  for (const origin of [`https://127.0.0.1:${p}`, `http://127.0.0.1:${p}/`, `http://127.0.0.1:${p}/x`, `http://127.0.0.1:${p + 1}`, 'null', 'http://evil.com', `http://u:p@127.0.0.1:${p}`]) {
    assert.equal((await post({ origin })).status, 403, origin);
  }
  for (const ct of ['application/jsonx', 'xapplication/json', 'text/plain; application/json', 'application/json-patch+json', 'text/plain']) {
    assert.equal((await post({ 'content-type': ct })).status, 415, ct);
  }
  assert.equal((await post({ 'content-type': 'application/json; charset=utf-8' })).status, 201);
  const chunked = await raw(p, `POST /api/runs HTTP/1.1\r\nHost: 127.0.0.1:${p}\r\nContent-Type: text/plain\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n2\r\n{}\r\n0\r\n\r\n`);
  assert.match(chunked, /^HTTP\/1\.1 415 /, chunked.slice(0, 80));
});

test('an unsupported Content-Encoding is a 415, not a 500', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());
  const r = await request(srv.port, 'POST', '/api/runs', { body: '{}', headers: { 'content-encoding': 'br' } });
  assert.equal(r.status, 415);
  assert.equal(r.json.error, 'unsupported_media_type');
});

test('security headers are on API and static responses; the health route sets no-store itself', async (t) => {
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'ntnp-dist-'));
  t.after(() => fs.rmSync(dist, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>ui</title>');
  fs.writeFileSync(path.join(dist, 'a.js'), 'console.log(1)');
  const srv = await startTestServer({ webDist: dist });
  t.after(() => srv.close());
  for (const route of ['/api/agents', '/', '/a.js']) {
    const r = await request(srv.port, 'GET', route);
    assert.equal(r.headers['x-content-type-options'], 'nosniff', route);
    assert.equal(r.headers['cache-control'], 'no-store', route);
    assert.equal(r.headers['referrer-policy'], 'no-referrer', route);
  }
  // on its own, without the app-wide headers
  const solo = express();
  const health = createHealth();
  solo.use('/h', health.router);
  const server = await new Promise((resolve) => { const s = solo.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(() => { health.stop(); server.close(); });
  const res = await fetch(`http://127.0.0.1:${server.address().port}/h`);
  assert.equal(res.headers.get('cache-control'), 'no-store');
});

test('GET /api/audit honours limit up to 500 and falls back to 200 beyond it', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());
  for (let i = 0; i < 60; i += 1) await request(srv.port, 'POST', '/api/runs', { body: { scenario: 'fee-waiver', profile: 'governed' } });
  const get = async (q) => (await request(srv.port, 'GET', `/api/audit${q}`)).json;
  assert.ok((await get('')).count > 201);
  assert.equal((await get('')).entries.length, 200);
  assert.equal((await get('?limit=2')).entries.length, 2);
  assert.equal((await get('?limit=500')).entries.length, (await get('')).count);
  assert.equal((await get('?limit=501')).entries.length, 200, 'over 500 falls back to 200');
  assert.equal((await get('?limit=0')).entries.length, 200);
  assert.equal((await get('?limit=abc')).entries.length, 200);
});

test('an unexpected error outside the API is a bare 500 that leaks nothing', async (t) => {
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'ntnp-dist-'));
  t.after(() => fs.rmSync(dist, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>ui</title>');
  const locked = path.join(dist, 'locked.txt');
  fs.writeFileSync(locked, 'x');
  fs.chmodSync(locked, 0o000);
  if (process.getuid?.() === 0) return t.skip('root can read a mode-000 file');
  const srv = await startTestServer({ webDist: dist });
  t.after(() => srv.close());
  const r = await request(srv.port, 'GET', '/locked.txt');
  assert.equal(r.status, 500);
  assert.deepEqual(r.json, { error: 'server_error' });
  assert.ok(!r.raw.includes('locked') && !r.raw.includes('EACCES') && !r.raw.includes(dist));
});

test('startHttpServer refuses a non-loopback bind without the opt-in', async () => {
  // Never actually listen on 0.0.0.0: if the guard were gone this would, so the host is a LAN-looking address that
  // cannot be bound, and the error text tells the two outcomes apart.
  const err = await startHttpServer({ port: 5399, host: '192.0.2.1', env: {}, webDist: null }).then((s) => { s.close(); return null; }, (e) => e);
  assert.match(String(err?.message), /loopback only/);
});

test('doctor: bind detail, and a governed agent holding a commit tool fails the boundary check', () => {
  const bind = (env) => runChecks({ env }).find((c) => c.id === 'bind');
  assert.match(bind({}).detail, /127\.0\.0\.1 \(loopback\)/);
  assert.match(bind({ NTNP_BIND: '0.0.0.0' }).detail, /opt-in/);
  const checks = runChecks({ env: {}, boundary: () => ['support-agent-governed holds waive_fee'] });
  const b = checks.find((c) => c.id === 'boundary');
  assert.equal(b.level, 'fail');
  assert.match(b.detail, /waive_fee/);
  assert.equal(allPassed(checks), false);
  assert.equal(runChecks({ env: {} }).find((c) => c.id === 'boundary').level, 'pass');
});

test('the server entry point refuses to start when a doctor check fails (port outside 5350-5399)', () => {
  const dir = path.dirname(SRC_DIR);
  const r = cp.spawnSync(process.execPath, [path.join(SRC_DIR, 'index.js')], { cwd: dir, env: { ...process.env, NTNP_PORT: 'abc' }, encoding: 'utf8', timeout: 20_000 });
  assert.equal(r.status, 1, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stderr, /refusing to start: port-range/);
});
