#!/usr/bin/env node
// Real-browser run of the web UI against the real server, which serves the UI itself (server/src/index.js).
// Runs every scenario in both profiles, checks the ledger difference, keyboard-only reach of Run and the panels,
// the diagram Simulate/Reset, no console errors, no off-origin requests, no horizontal scroll at 390px, and takes
// dark and light screenshots.
//
//   npm run build          (once; the server serves web/dist)
//   npm run e2e            starts the server on E2E_PORT (default 5370), drives it, stops it
//   E2E_SHOTS=/some/dir    where screenshots go (default .data/e2e-screenshots, git-ignored)
//
// Needs a Chromium for Playwright: `npx playwright install chromium` (README, Development).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shots = process.env.E2E_SHOTS || path.join(root, '.data', 'e2e-screenshots');
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });
let failures = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) failures += 1; };

const port = Number(process.env.E2E_PORT) || 5370;
if (!(port >= 5350 && port <= 5399)) { console.error('E2E_PORT must be in 5350-5399'); process.exit(2); }
const base = `http://127.0.0.1:${port}`;
if (!fs.existsSync(path.join(root, 'web', 'dist', 'index.html'))) { console.error('Run `npm run build` first.'); process.exit(2); }
const server = spawn(process.execPath, ['server/src/index.js'], { cwd: root, env: { ...process.env, NTNP_PORT: String(port) }, stdio: 'inherit' });
let up = false;
for (let i = 0; i < 80 && !up; i++) { try { up = (await fetch(`${base}/api/health`)).ok; } catch { await sleep(250); } }
if (!up) { server.kill(); console.error('server did not start'); process.exit(2); }
fs.mkdirSync(shots, { recursive: true });

const EXPECT = { 'fee-waiver': 1, 'refund-over-limit': 1, 'change-of-terms': 1, 'prompt-injected': 1, 'needs-approval': 0 };
const TITLES = { 'fee-waiver': 'Fee waiver request', 'refund-over-limit': 'Refund over the limit', 'change-of-terms': 'Change of terms', 'prompt-injected': 'Prompt-injected request', 'needs-approval': 'Tool exists but needs human approval' };

const browser = await chromium.launch({ executablePath: process.env.E2E_CHROMIUM || undefined });
try {
  const page = await browser.newPage({ viewport: { width: 1360, height: 900 }, colorScheme: 'light' });
  const external = []; const errors = []; const dialogs = [];
  page.on('request', (r) => { if (!r.url().startsWith(base) && !/^(data|blob):/.test(r.url())) external.push(r.url()); });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss(); });
  const shot = (name) => page.screenshot({ path: path.join(shots, `${name}.png`), fullPage: true });
  const active = () => page.evaluate(() => `${document.activeElement?.tagName}|${(document.activeElement?.textContent || document.activeElement?.value || '').trim().slice(0, 40)}`);

  const resp = await page.goto(`${base}/`);
  check(/default-src 'self'/.test(resp.headers()['content-security-policy'] || ''), 'the page is served with the same-origin CSP');
  await page.getByTestId('mode-badge').waitFor();
  check((await page.getByTestId('mode-badge').innerText()).includes('DEMO'), 'header shows the DEMO badge');
  await page.getByRole('radio', { name: TITLES['fee-waiver'] }).waitFor();
  check((await page.locator('table.registry [data-absent]').count()) === 3, 'registry shows the three commit tools absent for the governed agent');

  // Keyboard only: skip link, then radios and the Run both button.
  await page.keyboard.press('Tab');
  check((await active()).includes('Skip to content'), 'first Tab stop is the skip link');
  let reached = false;
  for (let i = 0; i < 20 && !reached; i++) { await page.keyboard.press('Tab'); reached = (await active()).endsWith('|Run both'); }
  check(reached, 'Tab reaches the Run both button');
  await page.keyboard.press('Enter');
  await page.getByTestId('ledger-entries').waitFor();
  check((await page.getByTestId('run-status').innerText()).includes('Ungoverned recorded 1 commitment; governed recorded 0'), 'keyboard Enter runs both and announces the result');

  // Every scenario in both profiles, driven by the UI.
  for (const [id, expected] of Object.entries(EXPECT)) {
    await page.getByRole('radio', { name: TITLES[id] }).check();
    const prev = await page.getByTestId('run-status').innerText();
    await page.getByRole('button', { name: 'Run both' }).click();
    await page.waitForFunction((p) => { const t = document.querySelector('[data-testid="run-status"]').textContent; return t && t !== p; }, prev);
    const un = page.getByTestId('col-ungoverned'); const gov = page.getByTestId('col-governed');
    const unCount = await un.locator('[data-testid="ledger-entries"] li').count();
    check(unCount === expected, `${id}: ungoverned ledger shows ${expected} commitment(s) (got ${unCount})`);
    check((await gov.locator('[data-testid="ledger-entries"]').count()) === 0 && (await gov.getByTestId('ledger-empty').count()) === 1, `${id}: governed ledger is empty`);
    if (id !== 'needs-approval') check((await gov.getByTestId('handoffs').innerText()).includes('review request'), `${id}: governed shows the human handoff request`);
    else check((await gov.getByTestId('handoffs').innerText()).includes('pending approval'), `${id}: tool exists but only a pending approval is created`);
    if (id === 'prompt-injected') check((await gov.innerText()).includes("denied: not in this agent's tool set"), `${id}: governed tool call to a missing tool is denied`);
  }
  const api = await (await fetch(`${base}/api/ledger`)).json();
  check(api.count === 5 && api.entries.every((e) => e.agentId === 'support-agent-ungoverned'), `server ledger holds the 5 ungoverned commitments (one keyboard run plus four scenario runs) and none from the governed agent (count ${api.count})`);

  // Loose wording: governed says it but the ledger stays empty.
  await page.getByRole('radio', { name: TITLES['fee-waiver'] }).check();
  await page.getByLabel('Agent wording').selectOption('loose');
  await page.getByRole('button', { name: 'Run both' }).click();
  await page.getByTestId('unbacked-governed').waitFor();
  check((await page.getByTestId('unbacked-governed').innerText()).includes('Said, not bound'), 'loose wording: governed reply is flagged "Said, not bound" while its ledger is empty');

  const govText = await page.getByTestId('col-governed').innerText();
  check(govText.includes('may still be treated as a promise') && !govText.includes('not bound to anything'), 'loose wording: the empty governed ledger does not claim the company is safe');
  const riskText = await page.locator('section.risk').innerText();
  check(riskText.includes('Reply text can still mislead a customer.') && riskText.includes('does not make the text true'), 'the residual-risk statement is on the page');
  check((await page.locator('.react-flow__edge[tabindex]').count()) === 0, 'diagram edges are not tab stops');

  // Audit Verify via keyboard.
  const verifyBtn = page.getByRole('button', { name: 'Verify audit trail' });
  await verifyBtn.focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('[data-testid="verify"]').textContent.startsWith('Verified'));
  check(true, `audit Verify: ${await page.getByTestId('verify').innerText()}`);
  check((await page.locator('[data-testid="audit-table"] tr.denied').count()) > 0, 'audit trail shows denied calls');

  // Diagram: Simulate and Reset.
  check((await page.locator('.react-flow__node').count()) === 7, 'diagram has seven boxes');
  const node = page.locator('.react-flow__node').first();
  const before = await node.boundingBox();
  await page.mouse.move(before.x + 20, before.y + 15); await page.mouse.down(); await page.mouse.move(before.x + 20, before.y + 95, { steps: 5 }); await page.mouse.up();
  const after = await node.boundingBox();
  check(Math.abs(after.y - before.y) > 20, 'a diagram box can be dragged');
  await page.getByLabel('Speed').selectOption('4');
  await page.getByRole('button', { name: 'Simulate' }).click();
  await page.waitForFunction(() => /^Step 1 of/.test(document.querySelector('[data-testid="caption"]').textContent));
  await page.waitForFunction(() => /^Step 6 of 6/.test(document.querySelector('[data-testid="caption"]').textContent), null, { timeout: 15000 });
  const cap = await page.getByTestId('caption').innerText();
  check(/no commit tool/.test(cap) || /said, not bound/.test(cap), `governed simulate reaches the end: "${cap}"`);
  await page.getByRole('button', { name: 'Reset diagram' }).click();
  check((await page.getByTestId('caption').innerText()).startsWith('Press Simulate'), 'Reset diagram clears the caption');
  await page.getByRole('button', { name: 'Ungoverned', exact: true }).last().click();
  await page.getByRole('button', { name: 'Simulate' }).click();
  await page.waitForFunction(() => /^Step 5 of/.test(document.querySelector('[data-testid="caption"]').textContent), null, { timeout: 15000 });
  check(/wrote 1 commitment/.test(await page.getByTestId('caption').innerText()), 'ungoverned simulate reaches the ledger');

  // Panels reachable by keyboard.
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  const seen = new Set();
  for (let i = 0; i < 80; i++) { await page.keyboard.press('Tab'); seen.add(await page.evaluate(() => document.activeElement?.closest('section,article,header')?.getAttribute('aria-labelledby') || document.activeElement?.closest('section,article,header')?.className || '')); }
  check(['pick-h', 'flow-h', 'aud-h'].every((h) => seen.has(h)), `Tab moves through the panels (${[...seen].join(', ')})`);

  await page.getByRole('button', { name: 'Reset', exact: true }).last().click();
  await page.getByRole('radio', { name: TITLES['fee-waiver'] }).check();
  await page.getByLabel('Agent wording').selectOption('careful');
  await page.getByRole('button', { name: 'Run both' }).click();
  await page.getByTestId('ledger-entries').waitFor();
  await shot('light-1360');
  await page.getByTestId('theme-select').selectOption('dark');
  check((await page.evaluate(() => document.documentElement.dataset.theme)) === 'dark', 'theme toggles to dark');
  await shot('dark-1360');

  // Mobile width, both themes.
  await page.setViewportSize({ width: 390, height: 800 });
  await sleep(300);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(overflow <= 0, `no horizontal scroll at 390px (overflow ${overflow})`);
  check((await page.locator('.scroll-x[tabindex="0"][role="region"]').count()) === 2, 'the registry and audit tables are focusable scroll regions');
  const nameBox = await page.locator('table.registry tbody th code').first().boundingBox();
  check(nameBox && nameBox.height < 30, `a tool name stays on one line at 390px (height ${nameBox?.height})`);
  await shot('dark-390');
  await page.getByTestId('theme-select').selectOption('light');
  await sleep(200);
  check((await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 0, 'no horizontal scroll at 390px, light');
  await shot('light-390');

  check(errors.length === 0, `no console errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
  check(external.length === 0, `no off-origin requests${external.length ? `: ${external.slice(0, 3).join(', ')}` : ''}`);
  check(dialogs.length === 0, 'no dialogs');
  console.log(`screenshots: ${shots}`);
} finally {
  await browser.close();
  server.kill();
}
console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);
