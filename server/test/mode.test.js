// MODE (rule 18): local is the default and unchanged; se-mock refuses every live flag and an unknown MODE, loudly,
// at startup, in the doctor and in the health reply.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc, request, startTestServer } from './helpers.js';

const config = await loadSrc('config.js');
const { runChecks, allPassed } = await loadSrc('doctor.js');
const { startHttpServer } = await loadSrc('app.js');

test('MODE: unset or empty is local; local and se-mock are the only values; anything else is unknown', () => {
  assert.equal(config.modeOf({}), 'local');
  assert.equal(config.modeOf({ MODE: '' }), 'local');
  assert.equal(config.modeOf({ MODE: 'local' }), 'local');
  assert.equal(config.modeOf({ MODE: 'se-mock' }), 'se-mock');
  for (const MODE of ['mock', 'SE-MOCK', ' se-mock', 'se-mock ', 'prod', 'live', 'constructor', '__proto__']) {
    assert.equal(config.modeOf({ MODE }), null, MODE);
  }
});

test('se-mock refuses each live flag by name; local is not refused for them (unchanged behaviour)', () => {
  for (const flag of config.LIVE_FLAGS) {
    assert.throws(() => config.assertModeAllowed({ MODE: 'se-mock', [flag]: '1' }), new RegExp(flag), flag);
    assert.throws(() => config.assertModeAllowed({ MODE: 'se-mock', [flag]: 'x' }), new RegExp(flag), flag);
    assert.equal(config.assertModeAllowed({ [flag]: '1' }), 'local', `${flag} in local`);
  }
  assert.equal(config.assertModeAllowed({ MODE: 'se-mock', NTNP_LIVE: '' }), 'se-mock', 'an empty live flag is not set');
  assert.equal(config.assertModeAllowed({ MODE: 'se-mock' }), 'se-mock');
});

test('an unknown MODE is refused, never a silent fallback to local', () => {
  assert.throws(() => config.assertModeAllowed({ MODE: 'prod' }), /MODE must be/);
});

test('the doctor fails loudly on a live flag in se-mock and on an unknown MODE; passes the defaults', () => {
  const check = (env) => runChecks({ env }).find((c) => c.id === 'mode');
  assert.equal(check({}).level, 'pass');
  assert.equal(check({ MODE: 'se-mock' }).level, 'pass');
  assert.equal(allPassed(runChecks({ env: { MODE: 'se-mock', NTNP_TENANT: 'x' } })), false);
  assert.equal(check({ MODE: 'se-mock', NTNP_TENANT: 'x' }).level, 'fail');
  assert.match(check({ MODE: 'se-mock', NTNP_TENANT: 'x' }).detail, /NTNP_TENANT/);
  assert.equal(check({ MODE: 'bogus' }).level, 'fail');
  assert.equal(allPassed(runChecks({ env: { MODE: 'se-mock' } })), true);
});

test('the server does not start in se-mock with a live flag (startHttpServer refuses before listening)', async () => {
  await assert.rejects(startHttpServer({ port: 5395, host: '127.0.0.1', env: { MODE: 'se-mock', NTNP_LLM_URL: 'x' }, webDist: null }), /live flag/);
  await assert.rejects(startHttpServer({ port: 5395, host: '127.0.0.1', env: { MODE: 'nope' }, webDist: null }), /MODE must be/);
});

test('health reports the mode and stays demo-health/1 in both modes', async (t) => {
  for (const [env, mode] of [[{}, 'local'], [{ MODE: 'se-mock' }, 'se-mock']]) {
    const srv = await startTestServer({ env });
    t.after(() => srv.close());
    const r = await request(srv.port, 'GET', '/api/health');
    assert.equal(r.status, 200, mode);
    assert.equal(r.json.schema, 'demo-health/1');
    assert.equal(r.json.state, 'ready');
    assert.equal(r.json.mode, mode);
    await srv.close();
  }
});

// Mock/Real switch (owner rule 19). This demo is mock only by design, so Real is refused unless the test-only
// `realAvailable` option is on (never read from the environment). Each test runs under the network guard.
const { guardNetwork } = await import('./netguard.js');

async function withSwitch(opts, fn) {
  const guard = guardNetwork();
  const srv = await startTestServer(opts);
  const mode = (body) => request(srv.port, 'POST', '/api/mode', { body });
  const info = async () => (await request(srv.port, 'GET', '/api/info')).json;
  try { await fn({ srv, mode, info }); } finally { await srv.close(); guard.restore(); }
  assert.deepEqual(guard.attempts, [], 'the switch made no outbound attempt');
}

test('GET /api/info: Mock by default, Real unavailable with the reason, not hosted', () => withSwitch({}, async ({ info }) => {
  const i = await info();
  assert.deepEqual({ source: i.source, realAvailable: i.realAvailable, hosted: i.hosted }, { source: 'mock', realAvailable: false, hosted: false });
  assert.match(i.realReason, /mock only by design/);
}));

test('Real without settings: 409, the mode stays Mock; Mock is accepted', () => withSwitch({}, async ({ mode, info }) => {
  const r = await mode({ source: 'real' });
  assert.equal(r.status, 409);
  assert.match(r.json.message, /mock only by design/);
  assert.equal((await info()).source, 'mock');
  const m = await mode({ source: 'mock' });
  assert.equal(m.status, 200);
  assert.equal(m.json.source, 'mock');
}));

test('POST /api/mode needs exactly {source: "mock" | "real"}: anything else is 400', () => withSwitch({ realAvailable: true }, async ({ srv, mode, info }) => {
  for (const body of [{}, { source: 'live' }, { mode: 'mock' }, { source: 'mock', extra: 1 }, { source: 1 }, [], 'null', '[]', '{not json']) {
    assert.equal((await mode(body)).status, 400, JSON.stringify(body));
  }
  assert.equal((await request(srv.port, 'POST', '/api/mode')).status, 400, 'no body');
  assert.equal((await info()).source, 'real', 'a refused body changes nothing');
}));

test('with Real configured (test option): Real is the default and the switch goes both ways without a restart; the data the page shows changes', () => withSwitch({ realAvailable: true }, async ({ srv, mode, info }) => {
  const first = await info();
  assert.deepEqual({ source: first.source, realAvailable: first.realAvailable, realReason: first.realReason }, { source: 'real', realAvailable: true, realReason: null });
  const toMock = await mode({ source: 'mock' });
  assert.equal(toMock.status, 200);
  assert.equal(toMock.json.source, 'mock');
  const mocked = await info();
  assert.equal(mocked.source, 'mock');
  assert.notDeepEqual(mocked, first, 'the mode-dependent response differs after the switch');
  const back = await mode({ source: 'real' });
  assert.equal(back.status, 200);
  assert.equal(back.json.source, 'real');
  assert.equal((await info()).source, 'real');
  assert.equal((await request(srv.port, 'GET', '/api/scenarios')).status, 200, 'the data endpoints keep answering after a switch');
}));

test('hosted build (MODE=se-mock): fail-closed Mock; every switch is 403 and Real is reported unavailable with the reason', () => withSwitch({ env: { MODE: 'se-mock' }, realAvailable: true }, async ({ mode, info }) => {
  const i = await info();
  assert.deepEqual({ source: i.source, realAvailable: i.realAvailable, hosted: i.hosted }, { source: 'mock', realAvailable: false, hosted: true });
  assert.match(i.realReason, /hosted build is Mock only/);
  assert.equal((await mode({ source: 'real' })).status, 403);
  assert.equal((await mode({ source: 'mock' })).status, 403);
  assert.equal((await mode({ source: 'bogus' })).status, 400, 'a malformed body is still 400 before the hosted check');
  assert.equal((await info()).source, 'mock');
}));

test('the mode is per app instance, not module-global', async () => {
  await withSwitch({ realAvailable: true }, async ({ mode, info }) => { await mode({ source: 'mock' }); assert.equal((await info()).source, 'mock'); });
  await withSwitch({ realAvailable: true }, async ({ info }) => assert.equal((await info()).source, 'real'));
});
