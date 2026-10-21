import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const root = new URL('..', import.meta.url).pathname;
const docs = ['README.md', 'docs/safety.md', 'docs/architecture.md'];
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

test('relative links in README and docs resolve to files that exist', () => {
  for (const d of docs) {
    for (const m of read(d).matchAll(/\]\((?!https?:|#|mailto:)([^)#\s]+)/g)) {
      assert.ok(fs.existsSync(path.resolve(path.dirname(path.join(root, d)), m[1])), `${d} links to missing ${m[1]}`);
    }
  }
});

test('every npm script and source file the docs name exists', () => {
  const pkg = JSON.parse(read('package.json'));
  const serverPkg = JSON.parse(read('server/package.json'));
  for (const d of docs) {
    for (const m of read(d).matchAll(/npm run ([\w-]+)(?! -w)/g)) assert.ok(pkg.scripts[m[1]] || serverPkg.scripts[m[1]], `${d}: npm run ${m[1]} does not exist`);
    for (const m of read(d).matchAll(/`((?:server|scripts)\/[\w./-]+\.(?:js|mjs))`/g)) assert.ok(fs.existsSync(path.join(root, m[1])), `${d} names missing file ${m[1]}`);
  }
});

test('the docs state the residual risk plainly and what is not checked', () => {
  const safety = read('docs/safety.md');
  assert.match(safety, /Reply text can still mislead a customer/);
  assert.match(safety, /does not make the text true/);
  assert.match(read('README.md'), /does not make the reply true/);
  assert.match(read('README.md'), /Cookie headers are not checked and never read/);
  assert.match(safety, /Cookie headers are not checked and never read/);
});

test('every API route the README lists exists in app.js, and every scenario it names exists', () => {
  const app = read('server/src/app.js');
  for (const m of read('README.md').matchAll(/`(GET|POST) (\/api\/[\w/:-]+)/g)) {
    if (m[2] === '/api/health') continue; // mounted with api.use('/health', ...)
    const route = m[2].replace(/^\/api/, '');
    assert.ok(app.includes(`api.${m[1].toLowerCase()}('${route}'`), `README lists ${m[1]} ${m[2]} but app.js has no such route`);
  }
  const scen = read('server/src/scenarios.js');
  for (const id of ['fee-waiver', 'refund-over-limit', 'change-of-terms', 'prompt-injected', 'needs-approval']) assert.ok(scen.includes(`'${id}'`));
});

test('the docs do not say the image was never built, and the README says how to get a browser for e2e', () => {
  for (const d of [...docs, 'CHANGELOG.md']) assert.doesNotMatch(read(d), /not (?:yet )?built or run|has not been built/i, d);
  assert.match(read('README.md'), /npx playwright install chromium/);
  assert.doesNotMatch(read('.githooks/pre-commit'), /CI still scans/);
});
