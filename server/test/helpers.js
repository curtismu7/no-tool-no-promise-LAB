// Test helpers. Ports: tests use only 5380-5399, found free at run time.
// NTNP_SRC_DIR points the boundary tests at a mutated copy of src/ (see mutation.test.js).
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const SRC_DIR = process.env.NTNP_SRC_DIR ? path.resolve(process.env.NTNP_SRC_DIR) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');
export const loadSrc = (file) => import(pathToFileURL(path.join(SRC_DIR, file)).href);

const FIRST = 5380; const LAST = 5399;
const isFree = (port) => new Promise((resolve) => {
  const s = net.createServer();
  s.once('error', () => resolve(false));
  s.listen(port, '127.0.0.1', () => s.close(() => resolve(true)));
});

// Start the app on a free port in 5380-5399. Retries when another test file takes the port first.
export async function startTestServer({ runtime, env = {}, webDist = null } = {}) {
  const { startHttpServer } = await loadSrc('app.js');
  const { createRuntime } = await loadSrc('runtime.js');
  const rt = runtime ?? createRuntime();
  let start = FIRST + Math.floor(Math.random() * (LAST - FIRST + 1));
  for (let i = 0; i < 40; i += 1) {
    const port = FIRST + ((start - FIRST + i) % (LAST - FIRST + 1));
    if (!(await isFree(port))) continue;
    try { return await startHttpServer({ port, host: '127.0.0.1', env, runtime: rt, webDist }); } catch (e) { if (e.code !== 'EADDRINUSE') throw e; }
  }
  throw new Error('no free port in 5380-5399');
}

// Like fetch, but lets a test set the Host header and send a raw body. Resolves { status, headers, json, raw }.
export function request(port, method, path_, { headers = {}, body, host } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body);
    const req = http.request({ host: '127.0.0.1', port, method, path: path_, agent: false, headers: { ...(payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}), ...(host ? { host } : {}), ...headers } }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => { let json = null; try { json = JSON.parse(raw); } catch { /* not json */ } resolve({ status: res.statusCode, headers: res.headers, json, raw }); });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}
