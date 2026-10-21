import { fileURLToPath } from 'node:url';
import { startHttpServer } from './app.js';
import { allPassed, runChecks } from './doctor.js';

// Local runs read the repo-root .env (real env vars win).
try { process.loadEnvFile(fileURLToPath(new URL('../../.env', import.meta.url))); } catch { /* no .env */ }

const checks = runChecks();
if (!allPassed(checks)) {
  for (const c of checks.filter((x) => x.level === 'fail')) console.error(`[no-tool-no-promise] refusing to start: ${c.id}: ${c.detail}`);
  process.exit(1);
}
const { url } = await startHttpServer();
console.log(`[no-tool-no-promise] mock mode (scripted agent, no LLM, no network) at ${url}`);
console.log(`[no-tool-no-promise] API: GET ${url}api/health | GET ${url}api/agents | GET ${url}api/scenarios | POST ${url}api/runs`);
