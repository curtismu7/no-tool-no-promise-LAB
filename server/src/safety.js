// Safety rules. Pure functions, no I/O.
//  1. Bind loopback only, unless NTNP_BIND opts in (the container does).
//  2. Every port this app uses is in 5350-5399.
//  3. Only loopback hosts, plus the names in LAB_ALLOWED_HOSTS (the lab-proxy's name for this app), are Host-header-accepted; no credential header is accepted; state-changing requests are CSRF-guarded.

export const SERVER_PORT = 5350;
export const PORT_MIN = 5350;
export const PORT_MAX = 5399;

const OCTET = '(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)';
const LOOPBACK_V4 = new RegExp(`^127\\.${OCTET}\\.${OCTET}\\.${OCTET}$`);
export function isLoopbackHost(host) {
  const h = String(host).toLowerCase().replace(/^\[|\]$/g, '');
  return h === 'localhost' || h === '::1' || LOOPBACK_V4.test(h);
}

export const portInRange = (p) => Number.isInteger(p) && p >= PORT_MIN && p <= PORT_MAX;
export const bindHost = (env = process.env) => env.NTNP_BIND || '127.0.0.1';
export const serverPort = (env = process.env) => (env.NTNP_PORT === undefined ? SERVER_PORT : Number(env.NTNP_PORT));

export function assertBindAllowed(host, env = process.env) {
  if (isLoopbackHost(host) || env.NTNP_BIND) return host;
  throw new Error(`refusing to bind ${host}: loopback only. Set NTNP_BIND to opt in (the container does).`);
}

// Strict Host parsing: "localhost", "127.x.y.z" (each octet 0-255) or "[::1]", optionally ":port". Anything else -> null.
const HOST_RE = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::(\d{1,5}))?$/i;
export function parseHost(hostHeader) {
  const m = HOST_RE.exec(String(hostHeader ?? '').trim());
  if (!m || !isLoopbackHost(m[1])) return null;
  if (m[2] !== undefined && Number(m[2]) > 65535) return null;
  return { hostname: m[1].toLowerCase().replace(/^\[|\]$/g, ''), port: m[2] === undefined ? null : Number(m[2]), host: `${m[1]}${m[2] === undefined ? '' : `:${m[2]}`}`.toLowerCase() };
}

// Extra Host names this app answers to (family standard): LAB_ALLOWED_HOSTS, comma separated host names that point at this Mac,
// such as the lab-proxy's no-tool-no-promise.local.ping-devops.com. Loopback always works; unset = loopback only.
const HOSTNAME = /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;
export function allowedHostsFrom(env = process.env) {
  const names = String(env.LAB_ALLOWED_HOSTS || '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
  for (const h of names) if (!HOSTNAME.test(h)) throw new Error(`LAB_ALLOWED_HOSTS: not a host name: ${h}`);
  return new Set(names);
}
const hostName = (hostHeader) => String(hostHeader ?? '').trim().toLowerCase().replace(/:\d{1,5}$/, '');

// Rejects a missing, malformed or non-allowed Host header (DNS rebinding): 421 Misdirected Request. `allowed` is the set of host
// names (no port, lower case) the lab-proxy sends in Host, from LAB_ALLOWED_HOSTS; loopback always works.
export const makeHostGuard = (allowed = new Set()) => function hostGuard(req, res, next) {
  if (!req.headers.host || !(parseHost(req.headers.host) || allowed.has(hostName(req.headers.host)))) {
    return res.status(421).json({ error: 'bad_host', message: 'this server answers loopback Host headers only' });
  }
  return next();
};
export const hostGuard = makeHostGuard();

// CSRF defence for anything that is not a plain read:
//  - Sec-Fetch-Site: cross-site is refused;
//  - an Origin header must be an http loopback origin identical to the Host the request was sent to, or, behind the lab-proxy,
//    the proxy's public origin (see below);
//  - a request with a body must be application/json.
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
export const makeOriginGuard = (allowed = new Set()) => function originGuard(req, res, next) {
  if (READ_METHODS.has(req.method)) return next();
  const refuse = (status, error, message) => res.status(status).json({ error, message });
  if (String(req.headers['sec-fetch-site'] || '').toLowerCase() === 'cross-site') return refuse(403, 'cross_site_refused', 'cross-site requests are refused');
  const origin = req.headers.origin;
  if (origin !== undefined) {
    let u = null;
    try { u = new URL(origin); } catch { /* refused below */ }
    const host = parseHost(req.headers.host);
    // Behind the lab-proxy the browser's origin is the proxy's public one (local.ping-devops.com:8443) while Host is this app's own
    // name. The proxy sets X-Forwarded-Host/-Proto; they are believed only when Host is one of the allowed names (loopback does not
    // count), so a request that did not come through the proxy cannot use them.
    const xfh = String(req.headers['x-forwarded-host'] || '').toLowerCase();
    const xfp = String(req.headers['x-forwarded-proto'] || 'https').toLowerCase();
    const proxied = allowed.has(hostName(req.headers.host)) && xfh !== '' && (xfp === 'https' || xfp === 'http') && origin === `${xfp}://${xfh}`;
    const same = proxied || u && u.protocol === 'http:' && u.origin !== 'null' && isLoopbackHost(u.hostname) && host
      && u.host.toLowerCase() === host.host && !u.username && !u.password && u.pathname === '/' && origin === u.origin;
    if (!same) return refuse(403, 'bad_origin', 'this server accepts same-origin loopback requests only');
  }
  const hasBody = Number(req.headers['content-length'] || 0) > 0 || req.headers['transfer-encoding'] !== undefined;
  if (hasBody && !/^application\/json\s*(;|$)/i.test(req.headers['content-type'] || '')) return refuse(415, 'unsupported_media_type', 'a request body must be application/json');
  return next();
};
export const originGuard = makeOriginGuard();

// No credential is ever accepted or used. A request that carries one is refused, not ignored.
// (Cookies are not checked: they are scoped by host not port. They are never read.)
const CREDENTIAL_HEADERS = ['authorization', 'proxy-authorization', 'x-api-key'];
export function credentialGuard(req, res, next) {
  if (CREDENTIAL_HEADERS.some((h) => req.headers[h] !== undefined)) {
    return res.status(400).json({ error: 'credentials_not_accepted', message: 'this server accepts and uses no credentials' });
  }
  return next();
}
