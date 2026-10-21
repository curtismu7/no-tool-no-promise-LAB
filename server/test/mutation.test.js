// Mutation pins: each safety check is removed from a COPY of src/ and the named test file, run against that copy,
// must then FAIL. If a check could be deleted without a test noticing, this file fails. The unmutated copy must pass,
// so a failure is caused by the mutation and not by the harness.
import test from 'node:test';
import assert from 'node:assert/strict';
import cp from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MUTATIONS = [
  ['tools.js', "if (!AGENTS.get(agentId).tools.has(tool)) return { granted: false, reason: 'not_in_tool_set' };", '', 'boundary.test.js', 'a tool outside the agent\'s set is no longer denied'],
  ['tools.js', "if (typeof tool !== 'string' || !TOOLS.has(tool)) return { granted: false, reason: 'unknown_tool' };", '', 'boundary.test.js', 'unknown tool names are no longer denied as unknown'],
  ['tools.js', "if (typeof agentId !== 'string' || !AGENTS.has(agentId)) return { granted: false, reason: 'unknown_agent' };", '', 'boundary.test.js', 'unknown agents are no longer denied'],
  ['tools.js', "tools: [...SHARED] },", "tools: [...SHARED, 'waive_fee'] },", 'boundary.test.js', 'the governed agent is handed a commit tool'],
  ['tools.js', 'if (bad.length) throw', 'if (false) throw', 'boundary.test.js', 'the boundary assertion no longer throws'],
  ['tools.js', 'if (keys.some((k) => !Object.hasOwn(def.args, k))) return { ok: false, reason: \'bad_args\' };', '', 'boundary.test.js', 'unknown argument keys (e.g. __proto__) are accepted'],
  ['app.js', 'if (extra.length) return bad(', 'if (false) return bad(', 'boundary.test.js', 'extra body fields on POST /api/runs are no longer refused'],
  ['chain.js', 'prev: head }', 'prev: GENESIS }', 'boundary.test.js', 'entries are no longer hash-linked'],
  ['chain.js', 'if (hashBody(body) !== hash)', 'if (false)', 'boundary.test.js', 'verification ignores tampered content'],
  ['safety.js', "String(req.headers['sec-fetch-site'] || '').toLowerCase() === 'cross-site'", 'false', 'safety.test.js', 'Sec-Fetch-Site cross-site is no longer refused'],
  ['safety.js', 'if (!same) return refuse', 'if (false) return refuse', 'safety.test.js', 'a foreign Origin is no longer refused'],
  ['safety.js', 'if (!req.headers.host || !parseHost(req.headers.host)) {', 'if (false) {', 'safety.test.js', 'the Host guard is off'],
  ['safety.js', 'if (CREDENTIAL_HEADERS.some((h) => req.headers[h] !== undefined)) {', 'if (false) {', 'safety.test.js', 'credential headers are accepted'],
  ['sanitize.js', 'export function revealText(value, max = 2000) {', 'export function revealText(value, max = 2000) { return String(value ?? \'\').slice(0, max);', 'planner.test.js', 'hidden characters are no longer made visible'],
  ['redaction.js', ".replace(/\\beyJ[A-Za-z0-9_-]{5,}\\.[A-Za-z0-9_-]{5,}\\.[A-Za-z0-9_-]*/g, MARK)", '', 'planner.test.js', 'JWT-shaped strings are no longer redacted'],
  ['app.js', "{ ...API_HEADERS, 'Content-Security-Policy': UI_CSP }", "{ ...API_HEADERS, 'Content-Security-Policy': \"default-src *\" }", 'ui.test.js', 'the UI is served without the same-origin-only CSP'],
  ['app.js', "dotfiles: 'ignore'", "dotfiles: 'allow'", 'ui.test.js', 'dotfiles in the UI directory are served'],
];

function runAgainst(srcDir, testFile) {
  // NODE_TEST_CONTEXT would make a nested runner report success to its parent; run the file as its own test process.
  const env = { ...process.env, NTNP_SRC_DIR: srcDir };
  delete env.NODE_TEST_CONTEXT;
  return cp.spawnSync(process.execPath, ['--test', `test/${testFile}`], { cwd: SERVER, env, encoding: 'utf8', timeout: 120_000 });
}

function makeCopy(label) {
  const dir = path.join(SERVER, `.mutant-${process.pid}-${label}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir);
  fs.cpSync(path.join(SERVER, 'src'), path.join(dir, 'src'), { recursive: true });
  fs.copyFileSync(path.join(SERVER, 'package.json'), path.join(dir, 'package.json'));
  return dir;
}

test('harness control: the unmutated copy passes every targeted test file', () => {
  const dir = makeCopy('control');
  try {
    for (const f of [...new Set(MUTATIONS.map((m) => m[3]))]) {
      const r = runAgainst(path.join(dir, 'src'), f);
      assert.equal(r.status, 0, `${f} must pass on an unmutated copy:\n${r.stdout.slice(-1500)}`);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

MUTATIONS.forEach(([file, find, replace, testFile, what], i) => {
  test(`mutation ${i + 1}: ${what}`, () => {
    const dir = makeCopy(`m${i}`);
    try {
      const target = path.join(dir, 'src', file);
      const text = fs.readFileSync(target, 'utf8');
      assert.ok(text.includes(find), `the mutation target text is gone from ${file}: ${find.slice(0, 60)}`);
      fs.writeFileSync(target, text.replace(find, () => replace));
      const r = runAgainst(path.join(dir, 'src'), testFile);
      assert.notEqual(r.status, 0, `MUTANT SURVIVED: ${what} (${file}) and ${testFile} still passed`);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});
