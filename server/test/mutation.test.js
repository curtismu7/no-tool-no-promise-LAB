// Mutation pins: each safety check is removed from a COPY of src/ and the named test file, run against that copy,
// must then FAIL. If a check could be deleted without a test noticing, this file fails. The unmutated copy must pass,
// so a failure is caused by the mutation and not by the harness.
//
// A mutant counts as KILLED only when the test process exits with status 1 after reporting at least one failed test:
// not on a timeout, a signal, a spawn error or a syntax error in the mutated copy (those would be false kills when the
// machine is busy). A find of { line: "text" } removes the one source line that contains that text.
import test, { describe } from 'node:test';
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
  // ND2: the survivors the review found, each now killed by a test
  ['safety.js', 'const HOST_RE = /^(localhost', 'const HOST_RE = /(localhost', 'http.test.js', 'the Host regex is no longer anchored at the start (evil.localhost passes)'],
  ['safety.js', "Number(m[2]) > 65535) return null;", "false) return null;", 'http.test.js', 'a Host port above 65535 is accepted'],
  ['safety.js', "u.protocol === 'http:' &&", '', 'http.test.js', 'an https Origin is accepted'],
  ['safety.js', '&& origin === u.origin', '', 'http.test.js', 'an Origin with a path is accepted'],
  ['safety.js', "/^application\\/json\\s*(;|$)/i", "/application\\/json\\s*(;|$)/i", 'http.test.js', 'the Content-Type check is not anchored at the start'],
  ['safety.js', "/^application\\/json\\s*(;|$)/i", "/^application\\/json\\s*(;)?/i", 'http.test.js', 'the Content-Type check is not anchored at the end'],
  ['safety.js', " || req.headers['transfer-encoding'] !== undefined", '', 'http.test.js', 'a chunked body is not treated as a body'],
  ['app.js', "err.type === 'encoding.unsupported'", 'false', 'http.test.js', 'an unsupported Content-Encoding is a 500 again'],
  ['app.js', ": res.status(500).json({ error: 'server_error' })", ": res.status(500).json({ error: String(err.message) })", 'http.test.js', 'the app-level 500 handler leaks the error message'],
  ['app.js', "'X-Content-Type-Options': 'nosniff', ", '', 'http.test.js', 'the nosniff header is gone'],
  ['app.js', "'Cache-Control': 'no-store', ", '', 'http.test.js', 'the no-store header is gone'],
  ['app.js', 'n <= 500', 'n <= 5000', 'http.test.js', 'the audit limit cap is raised'],
  ['app.js', '  assertBindAllowed(host, env);\n', '', 'http.test.js', 'startHttpServer binds a non-loopback host'],
  ['health.js', "res.set('Cache-Control', 'no-store');", '', 'http.test.js', 'the health route is cacheable'],
  ['doctor.js', "add('boundary', bad.length ? 'fail' : 'pass'", "add('boundary', 'pass'", 'http.test.js', 'the doctor ignores a boundary violation'],
  ['index.js', 'if (!allPassed(checks)) {', 'if (false) {', 'http.test.js', 'the server starts despite a failed doctor check'],
  ['runtime.js', '  boundaryCheck();\n', '', 'dispatch.test.js', 'the runtime no longer asserts the boundary at start'],
  ['runtime.js', 'runs.length >= limits.runs ||', '', 'dispatch.test.js', 'the run-count guard is gone'],
  ['runtime.js', 'audit.remaining() < 30 ||', '', 'dispatch.test.js', 'the audit-room guard is gone'],
  ['runtime.js', 'ledger.reader.remaining() < 5 ||', '', 'dispatch.test.js', 'the ledger-room guard is gone'],
  ['runtime.js', 'queues.reviews.length >= queues.cap - 5 ||', '', 'dispatch.test.js', 'the review-queue guard is gone'],
  ['runtime.js', '|| queues.approvals.length >= queues.cap - 5', '', 'dispatch.test.js', 'the approval-queue guard is gone'],
  ['runtime.js', 'return r ? structuredClone(r) : undefined;', 'return r;', 'dispatch.test.js', 'getRun hands out the stored run, not a copy'],
  ['toolbox.js', 'if (!v.ok) {', 'if (false) {', 'dispatch.test.js', 'the dispatcher stops validating arguments'],
  ['toolbox.js', 'handlers.get(tool)(context(agentId, runId), v.args)', 'handlers.get(tool)(context(agentId, runId), args)', 'dispatch.test.js', 'handlers get the caller\'s raw arguments'],
  ['toolbox.js', 'tool: revealText(tool, 64)', 'tool', 'dispatch.test.js', 'the audit log stores a raw tool name'],
  ['toolbox.js', 'agentId: revealText(agentId, 64)', 'agentId', 'dispatch.test.js', 'the audit log stores a raw agent id'],
  ['toolbox.js', "revealText(typeof tool === 'string' ? tool : String(typeof tool), 64)", "tool", 'dispatch.test.js', 'the result echoes a raw tool name'],
  ['toolbox.js', { line: "queues.reviews.length >= queues.cap" }, '', 'dispatch.test.js', 'the dispatcher review-queue cap is gone'],
  ['toolbox.js', { line: "queues.approvals.length >= queues.cap" }, '', 'dispatch.test.js', 'the dispatcher approval-queue cap is gone'],
  ['toolbox.js', 'ledger.remaining() <= 0', 'false', 'dispatch.test.js', 'a full ledger is no longer detected'],
  ['tools.js', "if (proto !== Object.prototype && proto !== null) return { ok: false, reason: 'bad_args' };", '', 'dispatch.test.js', 'arguments with a custom prototype are accepted'],
  ['tools.js', 'v.length > spec.max', 'false', 'dispatch.test.js', 'string length limits are not enforced'],
  ['tools.js', 'if (spec.required) return', 'if (false) return', 'dispatch.test.js', 'missing required arguments are accepted'],
  ['tools.js', 'v < spec.min', 'false', 'dispatch.test.js', 'the numeric minimum is not enforced'],
  ['tools.js', 'v > spec.max)', 'false)', 'dispatch.test.js', 'the numeric maximum is not enforced'],
  ['tools.js', { line: 'spec.enum && !spec.enum.includes(v)' }, '', 'dispatch.test.js', 'enum arguments are not checked'],
  ['tools.js', { line: 'spec.pattern && !spec.pattern.test(v)' }, '', 'dispatch.test.js', 'pattern arguments are not checked'],
  ['chain.js', 'let prev = GENESIS;', 'let prev = entries[0]?.prev ?? GENESIS;', 'dispatch.test.js', 'verification trusts the first entry\'s own link'],
  ['chain.js', { line: "reason: 'bad_sequence'" }, '', 'dispatch.test.js', 'verification ignores the sequence number'],
  ['chain.js', { line: "reason: 'bad_link'" }, '', 'dispatch.test.js', 'verification ignores the link to the previous entry'],
  ['sanitize.js', '\\u{E0000}-\\u{E007F}', '', 'redaction.test.js', 'the Unicode tag block is no longer shown'],
  ['sanitize.js', '\\u{E0100}-\\u{E01EF}', '', 'redaction.test.js', 'the variation selector supplement is no longer shown'],
  ['sanitize.js', '\\uD800-\\uDFFF', '', 'redaction.test.js', 'lone surrogates are no longer shown'],
  ['sanitize.js', '\\u2028\\u2029', '', 'redaction.test.js', 'line and paragraph separators are no longer shown'],
  ['sanitize.js', "new RegExp(INVISIBLE.source, 'gu')", "new RegExp(INVISIBLE.source, 'u')", 'redaction.test.js', 'stripInvisible removes only the first hidden character'],
  ['sanitize.js', 's.length > max ?', 'false ?', 'redaction.test.js', 'revealText no longer truncates'],
  ['redaction.js', 'revealText(redactText(revealText(value, max * 4)), max)', 'revealText(redactText(value), max)', 'redaction.test.js', 'text is redacted before it is revealed (a separator hides the tail of a secret)'],
  ['redaction.js', { line: '-----BEGIN' }, '', 'redaction.test.js', 'PEM blocks are no longer redacted'],
  ['redaction.js', { line: 'redactUrl(m)' }, '', 'redaction.test.js', 'URLs in text are no longer redacted'],
  ['redaction.js', { line: 'Set-Cookie|Cookie' }, '', 'redaction.test.js', 'Cookie headers are no longer redacted'],
  ['redaction.js', { line: '(Bearer|Basic)\\s+' }, '', 'redaction.test.js', 'Bearer and Basic credentials are no longer redacted'],
  ['redaction.js', { line: '(--?[' }, '', 'redaction.test.js', 'CLI --flag values are no longer redacted'],
  ['redaction.js', { line: '(=)(?!' }, '', 'redaction.test.js', 'key=value secrets are no longer redacted'],
  ['redaction.js', { line: '(["\']?' }, '', 'redaction.test.js', 'JSON and "key: value" secrets are no longer redacted'],
  ['redaction.js', { line: '(Proxy-)?Authorization' }, '', 'redaction.test.js', 'Authorization headers are no longer redacted'],
  ['redaction.js', { line: 'AKIA|ASIA' }, '', 'redaction.test.js', 'AWS access key ids are no longer redacted'],
  ['redaction.js', '(?:AKIA|ASIA)', 'AKIA', 'redaction.test.js', 'temporary AWS key ids (ASIA) are no longer redacted'],
  ['redaction.js', { line: '(?:sk|pk|ghp' }, '', 'redaction.test.js', 'sk-, pk_, ghp_ and xox keys are no longer redacted'],
  ['redaction.js', 'if (SECRET_KEY.test(key)) url.searchParams.delete(key);', '', 'redaction.test.js', 'secret URL query parameters are kept'],
  ['redaction.js', 'url.hash.length > 1', 'false', 'redaction.test.js', 'secret URL fragment parameters are kept'],
  ['redaction.js', "url.username = '';", '', 'redaction.test.js', 'URL user names are kept'],
  ['redaction.js', "url.password = '';", '', 'redaction.test.js', 'URL passwords are kept'],
  ['planner.js', ".normalize('NFKC')", '', 'planner.test.js', 'the planner no longer folds compatibility characters'],
  ['planner.js', "stripInvisible(String(message ?? ''))", "String(message ?? '')", 'planner.test.js', 'the planner no longer strips hidden characters before matching'],
  ['planner.js', ' || JS_NAMES.has(m[1].toLowerCase())', '', 'planner.test.js', 'the planner no longer attempts JavaScript built-in names'],
  ['planner.js', 'if (denied.length) parts.push(', 'if (false) parts.push(', 'planner.test.js', 'the reply no longer says an attempted action had no tool'],
  ['planner.js', '|done\\b', '', 'planner.test.js', 'the promise heuristic ignores "done"'],
];

// Exported only so the tests below can check the kill rule itself.
export function judge(r) {
  const out = `${r.stdout ?? ''}\n${r.stderr ?? ''}`;
  if (r.error) return { killed: false, why: `spawn error: ${r.error.message}` };
  if (r.signal) return { killed: false, why: `ended by signal ${r.signal} (timeout or kill), not a test failure` };
  if (r.status !== 1) return { killed: false, why: `exit status ${r.status}` };
  if (/SyntaxError|ERR_MODULE_NOT_FOUND|ReferenceError: .* is not defined/.test(out)) return { killed: false, why: 'the mutated copy does not even load' };
  const failed = /^ℹ fail (\d+)/m.exec(out);
  if (!failed || Number(failed[1]) < 1) return { killed: false, why: 'no failed test was reported' };
  return { killed: true };
}

function runAgainst(srcDir, testFile) {
  // NODE_TEST_CONTEXT would make a nested runner report success to its parent; run the file as its own test process.
  const env = { ...process.env, NTNP_SRC_DIR: srcDir };
  delete env.NODE_TEST_CONTEXT;
  return new Promise((resolve) => {
    cp.execFile(process.execPath, ['--test', `test/${testFile}`], { cwd: SERVER, env, encoding: 'utf8', timeout: 240_000, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({ status: error ? (typeof error.code === 'number' ? error.code : null) : 0, signal: error?.signal ?? (error?.killed ? 'SIGTERM' : null), error: error && typeof error.code !== 'number' && !error.signal && !error.killed ? error : null, stdout, stderr });
    });
  });
}

function makeCopy(label) {
  const dir = path.join(SERVER, `.mutant-${process.pid}-${label}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir);
  fs.cpSync(path.join(SERVER, 'src'), path.join(dir, 'src'), { recursive: true });
  fs.copyFileSync(path.join(SERVER, 'package.json'), path.join(dir, 'package.json'));
  return dir;
}

function mutate(text, find, replace) {
  if (typeof find === 'string') {
    assert.ok(text.includes(find), `the mutation target text is gone: ${find.slice(0, 70)}`);
    return text.replace(find, () => replace);
  }
  const lines = text.split('\n');
  const hits = lines.map((l, i) => (l.includes(find.line) ? i : -1)).filter((i) => i >= 0);
  assert.equal(hits.length, 1, `expected exactly one line containing ${find.line} and found ${hits.length}`);
  lines.splice(hits[0], 1);
  return lines.join('\n');
}

describe('the kill rule', () => {
  const base = { status: 1, signal: null, error: null, stdout: 'ℹ fail 2\n', stderr: '' };
  test('only a real test failure is a kill', () => {
    assert.equal(judge(base).killed, true);
    assert.equal(judge({ ...base, status: null, signal: 'SIGTERM' }).killed, false, 'timeout / signal');
    assert.equal(judge({ ...base, status: null }).killed, false, 'null status');
    assert.equal(judge({ ...base, status: 0 }).killed, false, 'passing run');
    assert.equal(judge({ ...base, status: 143 }).killed, false, 'killed process');
    assert.equal(judge({ ...base, error: new Error('spawn') }).killed, false);
    assert.equal(judge({ ...base, stderr: 'SyntaxError: Unexpected token' }).killed, false, 'a broken mutant is not a kill');
    assert.equal(judge({ ...base, stdout: 'ℹ fail 0\n' }).killed, false, 'no failed test');
  });
  test('a find that matches no line, or more than one, is refused', () => {
    assert.throws(() => mutate('a\nb', { line: 'zzz' }, ''), /exactly one line/);
    assert.throws(() => mutate('ab\nab', { line: 'ab' }, ''), /exactly one line/);
    assert.equal(mutate('a\nb\nc', { line: 'b' }, ''), 'a\nc');
  });
});

test('harness control: the unmutated copy passes every targeted test file', async () => {
  const dir = makeCopy('control');
  try {
    for (const f of [...new Set(MUTATIONS.map((m) => m[3]))]) {
      const r = await runAgainst(path.join(dir, 'src'), f);
      assert.equal(r.status, 0, `${f} must pass on an unmutated copy (signal ${r.signal}):
${r.stdout.slice(-1500)}`);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

describe('mutants', { concurrency: 3 }, () => {
  MUTATIONS.forEach(([file, find, replace, testFile, what], i) => {
    test(`mutation ${i + 1}: ${what}`, async () => {
      const dir = makeCopy(`m${i}`);
      try {
        const target = path.join(dir, 'src', file);
        fs.writeFileSync(target, mutate(fs.readFileSync(target, 'utf8'), find, replace));
        const r = await runAgainst(path.join(dir, 'src'), testFile);
        const verdict = judge(r);
        assert.ok(verdict.killed, `MUTANT NOT KILLED: ${what} (${file}, ${testFile}): ${verdict.why ?? 'the test file still passed'}`);
      } finally { fs.rmSync(dir, { recursive: true, force: true }); }
    });
  });
});
