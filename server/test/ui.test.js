import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadSrc, request, startTestServer } from './helpers.js';

const { UI_CSP } = await loadSrc('app.js');

function fakeDist(t) {
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'ntnp-dist-'));
  t.after(() => fs.rmSync(dist, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>ui</title>');
  fs.mkdirSync(path.join(dist, 'assets'));
  fs.writeFileSync(path.join(dist, 'assets', 'a.js'), 'console.log(1)');
  fs.writeFileSync(path.join(dist, '.secret'), 'x');
  return dist;
}

test('the built UI is served with a same-origin-only CSP, and the API keeps its own', async (t) => {
  const srv = await startTestServer({ webDist: fakeDist(t) });
  t.after(() => srv.close());
  const page = await request(srv.port, 'GET', '/');
  assert.equal(page.status, 200);
  assert.match(page.raw, /<title>ui<\/title>/);
  assert.equal(page.headers['content-security-policy'], UI_CSP);
  assert.equal(page.headers['x-content-type-options'], 'nosniff');
  for (const bad of ['http:', 'https:', '*', "'unsafe-eval'"]) assert.ok(!UI_CSP.split(/[ ;]/).includes(bad), `CSP must not contain ${bad}`);
  assert.match(UI_CSP, /connect-src 'self'/);
  assert.match(UI_CSP, /frame-ancestors 'none'/);
  assert.equal((await request(srv.port, 'GET', '/assets/a.js')).headers['content-security-policy'], UI_CSP);
  assert.equal((await request(srv.port, 'GET', '/.secret')).status, 404);
  const api = await request(srv.port, 'GET', '/api/health');
  assert.equal(api.headers['content-security-policy'], "default-src 'none'");
});

test('the static UI does not weaken the Host guard or open a write route', async (t) => {
  const srv = await startTestServer({ webDist: fakeDist(t) });
  t.after(() => srv.close());
  assert.equal((await request(srv.port, 'GET', '/', { host: 'evil.example' })).status, 421);
  assert.notEqual((await request(srv.port, 'POST', '/', { body: {} })).status, 200);
  assert.equal((await request(srv.port, 'GET', '/api/nope')).status, 404);
});

test('without a built UI the root is a JSON 404', async (t) => {
  const srv = await startTestServer({ webDist: path.join(os.tmpdir(), 'ntnp-no-such-dist') });
  t.after(() => srv.close());
  const r = await request(srv.port, 'GET', '/');
  assert.equal(r.status, 404);
  assert.equal(r.json.error, 'not_found');
});
