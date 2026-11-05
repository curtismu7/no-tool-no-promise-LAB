// One Express app: the API under /api. createApp() is what the tests use.
// Every customer- or agent-provided string in a response was made inert and redacted when it was stored; all of it
// is served as JSON only.
// MODE=se-mock: every /api request except /api/health runs against the runtime of its workspace (X-Workspace-Id).
// MODE=local: every request runs against the one process-wide runtime, as before.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { assertModeAllowed } from './config.js';
import { createHealth } from './health.js';
import { loadCustomer, DEFAULT_CUSTOMER } from './customer.js';
import { RunError, createRuntime } from './runtime.js';
import { assertBindAllowed, bindHost, credentialGuard, hostGuard, originGuard, serverPort } from './safety.js';
import { registryView } from './tools.js';
import { WORKSPACE_HEADER, createWorkspaces, resolveWorkspaceId } from './workspaces.js';
import { shelfInfo } from './shelfLink.js';

export const DEFAULT_WEB_DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');
// The built UI: same-origin scripts, styles, images and fetches only. style-src allows inline styles because React Flow sets them.
export const UI_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const bad = (res, message, status = 400) => res.status(status).json({ error: status === 404 ? 'not_found' : 'bad_request', message });
const API_HEADERS = { 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'", 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v));
const RUN_KEYS = new Set(['scenario', 'profile', 'wording', 'message']);

// webDist: directory with the built UI (web/dist). null disables static serving.
// mode: 'local' (default) or 'se-mock'. workspaceOptions: { max, ttlMs, now } for the se-mock registry (tests lower them).
export function createApp({ runtime, health = createHealth(), webDist = DEFAULT_WEB_DIST, mode = 'local', workspaceOptions = {}, realAvailable = false, customer = loadCustomer() } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(hostGuard);
  app.use(originGuard);
  app.use((_req, res, next) => { res.set(API_HEADERS); next(); });
  if (webDist && fs.existsSync(path.join(webDist, 'index.html'))) {
app.get('/api/shelf', (_req, res) => { res.set('Cache-Control', 'no-store'); res.json(shelfInfo()); }); // the header "Shelf" button
    app.use(express.static(webDist, {
      index: 'index.html', dotfiles: 'ignore',
      setHeaders: (res) => res.set({ ...API_HEADERS, 'Content-Security-Policy': UI_CSP }),
    }));
  }

  const workspaces = mode === 'se-mock'
    ? createWorkspaces({ defaultRuntime: runtime, create: () => createRuntime(), ...workspaceOptions })
    : null;
  // Picks the runtime for this request. Local: always the process-wide one. se-mock: the workspace named by the header.
  function workspaceGuard(req, res, next) {
    if (!workspaces) { req.runtime = runtime; return next(); }
    const id = resolveWorkspaceId(req.headers[WORKSPACE_HEADER]);
    if (id === null) return res.status(400).json({ error: 'bad_workspace', message: `${WORKSPACE_HEADER} must be 1-32 lowercase letters, digits or hyphens, starting with a letter or digit` });
    // Only creating a run allocates a workspace. Any other request (a read, an unknown endpoint, a Reset) gets the
    // workspace if it exists, else a throwaway empty runtime that is not kept, so a flood of reads cannot evict a visitor.
    req.runtime = req.method === 'POST' && req.path === '/runs' ? workspaces.get(id) : (workspaces.peek(id) ?? createRuntime());
    req.workspace = id;
    return next();
  }

  const api = express.Router();
  api.use(credentialGuard);
  api.use('/health', health.router);
  api.use(workspaceGuard);
  api.use(express.json({ limit: '4kb' }));

  // Rule 19: the Mock/Real toggle's API. This app is mock only (no tenant, no model, no network), so Real is never available.
  // The mode is in memory, so a switch needs no restart. `realAvailable` is a test-only seam (never read from the environment).
  const NO_REAL = 'Real is not available: this app has no live version (no tenant, no model, no network). Mock is the whole demo.';
  const canReal = realAvailable === true;
  const modeState = { source: canReal ? 'real' : 'mock' }; // default: Real if configured, else Mock
  const infoBody = () => ({ source: modeState.source, realAvailable: canReal, realReason: canReal ? null : NO_REAL });
  api.get('/info', (_req, res) => res.json(infoBody()));
  api.post('/mode', (req, res) => {
    const b = req.body;
    if (!isPlain(b) || Object.keys(b).length !== 1 || !['mock', 'real'].includes(b.source)) return bad(res, 'body must be exactly {source: "mock" or "real"}');
    if (b.source === 'real' && !canReal) return bad(res, NO_REAL, 409);
    modeState.source = b.source;
    return res.json(infoBody());
  });

  api.get('/scenarios', (req, res) => res.json({ scenarios: req.runtime.scenarios(), customer: { ...DEFAULT_CUSTOMER, ...customer } }));
  api.get('/agents', (_req, res) => res.json(registryView()));

  api.post('/runs', (req, res) => {
    const body = req.body === undefined ? {} : req.body;
    if (!isPlain(body)) return bad(res, 'the body must be a JSON object');
    // Only these four fields exist. There is no field that names an agent or a tool, and any other key is refused.
    const extra = Object.keys(body).filter((k) => !RUN_KEYS.has(k));
    if (extra.length) return bad(res, 'unknown field: a run takes scenario, profile, optional wording and message only');
    try { return res.status(201).json(req.runtime.run(body)); } catch (e) {
      if (e instanceof RunError) return res.status(e.status).json({ error: e.code, message: e.message });
      throw e;
    }
  });
  api.get('/runs', (req, res) => res.json({ runs: req.runtime.runs() }));
  api.get('/runs/:id', (req, res) => {
    const r = /^run-\d{1,6}$/.test(req.params.id) ? req.runtime.getRun(req.params.id) : undefined;
    return r ? res.json(r) : bad(res, 'no such run', 404);
  });

  api.get('/ledger', (req, res) => {
    const l = req.runtime.ledger;
    res.json({ appendOnly: true, writableBy: 'tool handlers only', cap: l.cap, count: l.size(), head: l.head(), entries: l.entries() });
  });
  api.get('/reviews', (req, res) => res.json(req.runtime.queues()));

  api.get('/audit/verify', (req, res) => res.json({ audit: req.runtime.audit.verify(), ledger: req.runtime.ledger.verify() }));
  api.get('/audit', (req, res) => {
    const n = Number(req.query.limit ?? 200);
    const limit = Number.isInteger(n) && n >= 1 && n <= 500 ? n : 200;
    const all = req.runtime.audit.entries();
    res.json({ cap: req.runtime.audit.cap, count: all.length, head: req.runtime.audit.head(), entries: all.slice(-limit) });
  });

  api.post('/reset', (req, res) => {
    if (req.body && Object.keys(req.body).length) return bad(res, 'POST /api/reset takes no parameters');
    req.runtime.reset();
    return res.json({ ok: true });
  });

  api.use((_req, res) => bad(res, 'no such endpoint', 404));
  api.use((err, _req, res, _next) => {
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'payload_too_large', message: 'request body is too large' });
    if (err.type === 'entity.parse.failed') return bad(res, 'request body is not valid JSON');
    if (err.type === 'encoding.unsupported') return res.status(415).json({ error: 'unsupported_media_type', message: 'content encoding is not supported' });
    if (err instanceof URIError || err.status === 400) return bad(res, 'malformed request');
    console.error('[no-tool-no-promise] api error:', err.message);
    return res.status(500).json({ error: 'server_error' });
  });
  app.use('/api', api);
  app.use((_req, res) => bad(res, 'no such endpoint', 404));
  app.use((err, _req, res, _next) => (err instanceof URIError || err.status === 400 ? bad(res, 'malformed request') : res.status(500).json({ error: 'server_error' })));
  return app;
}

// Boot on `port`. Refuses a non-loopback host unless NTNP_BIND is set. Refuses an unknown MODE or a live flag in se-mock.
export async function startHttpServer({ port = serverPort(), host = bindHost(), env = process.env, runtime = createRuntime(), webDist = DEFAULT_WEB_DIST, workspaceOptions, realAvailable } = {}) {
  assertBindAllowed(host, env);
  const mode = assertModeAllowed(env);
  const health = createHealth({ env });
  return new Promise((resolve, reject) => {
    const httpServer = createApp({ runtime, health, webDist, mode, workspaceOptions, realAvailable }).listen(port, host);
    httpServer.once('error', (e) => { health.stop(); reject(e); });
    httpServer.once('listening', () => {
      const { port: bound } = httpServer.address();
      resolve({
        port: bound, runtime, mode, url: `http://127.0.0.1:${bound}/`,
        close: async () => { health.stop(); await new Promise((r) => { httpServer.closeAllConnections?.(); httpServer.close(r); }); },
      });
    });
  });
}
