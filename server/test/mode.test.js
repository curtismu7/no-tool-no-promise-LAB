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
