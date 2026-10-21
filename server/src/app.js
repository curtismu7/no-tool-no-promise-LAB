// One Express app: the API under /api. createApp() is what the tests use.
// Every customer- or agent-provided string in a response was made inert and redacted when it was stored; all of it
// is served as JSON only.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createHealth } from './health.js';
import { RunError, createRuntime } from './runtime.js';
import { assertBindAllowed, bindHost, credentialGuard, hostGuard, originGuard, serverPort } from './safety.js';
import { registryView } from './tools.js';

export const DEFAULT_WEB_DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');
// The built UI: same-origin scripts, styles, images and fetches only. style-src allows inline styles because React Flow sets them.
export const UI_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const bad = (res, message, status = 400) => res.status(status).json({ error: status === 404 ? 'not_found' : 'bad_request', message });
const API_HEADERS = { 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'", 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v));
const RUN_KEYS = new Set(['scenario', 'profile', 'wording', 'message']);

// webDist: directory with the built UI (web/dist). null disables static serving.
export function createApp({ runtime, health = createHealth(), webDist = DEFAULT_WEB_DIST } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(hostGuard);
  app.use(originGuard);
  app.use((_req, res, next) => { res.set(API_HEADERS); next(); });
  if (webDist && fs.existsSync(path.join(webDist, 'index.html'))) {
    app.use(express.static(webDist, {
      index: 'index.html', dotfiles: 'ignore',
      setHeaders: (res) => res.set({ ...API_HEADERS, 'Content-Security-Policy': UI_CSP }),
    }));
  }

  const api = express.Router();
  api.use(credentialGuard);
  api.use('/health', health.router);
  api.use(express.json({ limit: '4kb' }));

  api.get('/scenarios', (_req, res) => res.json({ scenarios: runtime.scenarios() }));
  api.get('/agents', (_req, res) => res.json(registryView()));

  api.post('/runs', (req, res) => {
    const body = req.body === undefined ? {} : req.body;
    if (!isPlain(body)) return bad(res, 'the body must be a JSON object');
    // Only these four fields exist. There is no field that names an agent or a tool, and any other key is refused.
    const extra = Object.keys(body).filter((k) => !RUN_KEYS.has(k));
    if (extra.length) return bad(res, 'unknown field: a run takes scenario, profile, optional wording and message only');
    try { return res.status(201).json(runtime.run(body)); } catch (e) {
      if (e instanceof RunError) return res.status(e.status).json({ error: e.code, message: e.message });
      throw e;
    }
  });
  api.get('/runs', (_req, res) => res.json({ runs: runtime.runs() }));
  api.get('/runs/:id', (req, res) => {
    const r = /^run-\d{1,6}$/.test(req.params.id) ? runtime.getRun(req.params.id) : undefined;
    return r ? res.json(r) : bad(res, 'no such run', 404);
  });

  api.get('/ledger', (_req, res) => {
    const l = runtime.ledger;
    res.json({ appendOnly: true, writableBy: 'tool handlers only', cap: l.cap, count: l.size(), head: l.head(), entries: l.entries() });
  });
  api.get('/reviews', (_req, res) => res.json(runtime.queues()));

  api.get('/audit/verify', (_req, res) => res.json({ audit: runtime.audit.verify(), ledger: runtime.ledger.verify() }));
  api.get('/audit', (req, res) => {
    const n = Number(req.query.limit ?? 200);
    const limit = Number.isInteger(n) && n >= 1 && n <= 500 ? n : 200;
    const all = runtime.audit.entries();
    res.json({ cap: runtime.audit.cap, count: all.length, head: runtime.audit.head(), entries: all.slice(-limit) });
  });

  api.post('/reset', (req, res) => {
    if (req.body && Object.keys(req.body).length) return bad(res, 'POST /api/reset takes no parameters');
    runtime.reset();
    return res.json({ ok: true });
  });

  api.use((_req, res) => bad(res, 'no such endpoint', 404));
  api.use((err, _req, res, _next) => {
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'payload_too_large', message: 'request body is too large' });
    if (err.type === 'entity.parse.failed') return bad(res, 'request body is not valid JSON');
    if (err instanceof URIError || err.status === 400) return bad(res, 'malformed request');
    console.error('[no-tool-no-promise] api error:', err.message);
    return res.status(500).json({ error: 'server_error' });
  });
  app.use('/api', api);
  app.use((_req, res) => bad(res, 'no such endpoint', 404));
  app.use((err, _req, res, _next) => (err instanceof URIError || err.status === 400 ? bad(res, 'malformed request') : res.status(500).json({ error: 'server_error' })));
  return app;
}

// Boot on `port`. Refuses a non-loopback host unless NTNP_BIND is set.
export async function startHttpServer({ port = serverPort(), host = bindHost(), env = process.env, runtime = createRuntime(), webDist = DEFAULT_WEB_DIST } = {}) {
  assertBindAllowed(host, env);
  const health = createHealth({ env });
  return new Promise((resolve, reject) => {
    const httpServer = createApp({ runtime, health, webDist }).listen(port, host);
    httpServer.once('error', (e) => { health.stop(); reject(e); });
    httpServer.once('listening', () => {
      const { port: bound } = httpServer.address();
      resolve({
        port: bound, runtime, url: `http://127.0.0.1:${bound}/`,
        close: async () => { health.stop(); await new Promise((r) => { httpServer.closeAllConnections?.(); httpServer.close(r); }); },
      });
    });
  });
}
