// Preflight checks shared by `npm run doctor` and GET /api/health. Synchronous, no network, never prints a secret.
// Each check: { id, level: 'pass' | 'info' | 'fail', detail }.
import { PORT_MAX, PORT_MIN, assertBindAllowed, bindHost, portInRange, serverPort } from './safety.js';
import { boundaryViolations } from './tools.js';

export function runChecks({ env = process.env, boundary = boundaryViolations } = {}) {
  const checks = [];
  const add = (id, level, detail) => checks.push({ id, level, detail });

  const major = Number(process.versions.node.split('.')[0]);
  add('node', major >= 20 ? 'pass' : 'fail', `v${process.versions.node} (need >= 20)`);

  try { add('bind', 'pass', `${assertBindAllowed(bindHost(env), env)}${env.NTNP_BIND ? ' (NTNP_BIND opt-in)' : ' (loopback)'}`); }
  catch (e) { add('bind', 'fail', e.message); }

  const port = serverPort(env);
  add('port-range', portInRange(port) ? 'pass' : 'fail', portInRange(port) ? `server port ${port} (allowed ${PORT_MIN}-${PORT_MAX})` : `server port ${port} is outside ${PORT_MIN}-${PORT_MAX}`);

  const bad = boundary();
  add('boundary', bad.length ? 'fail' : 'pass', bad.length ? `a governed agent holds a commit tool: ${bad.join(', ')}` : 'the governed tool set holds no tool that can commit the company');

  add('outbound', 'pass', 'no outbound settings: no LLM, no tenant, no network; the agent is a scripted planner');
  return checks;
}

export const allPassed = (checks) => checks.every((c) => c.level !== 'fail');
