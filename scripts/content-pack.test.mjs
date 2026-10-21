import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { PACK_PATH, buildPack, serialize } from './build-content-pack.mjs';
import { validatePack } from './validate-content-pack.mjs';

test('content-pack.json is exactly what the generator produces (run: npm run content-pack)', () => {
  assert.equal(fs.readFileSync(PACK_PATH, 'utf8'), serialize(buildPack()), 'content-pack.json is stale; regenerate it and commit the result');
});

test('the generator is deterministic', () => assert.equal(serialize(buildPack()), serialize(buildPack())));

test('content-pack.json validates against docs/content-pack.schema.json', () => {
  assert.deepEqual(validatePack(JSON.parse(fs.readFileSync(PACK_PATH, 'utf8'))), []);
});

test('the validator rejects a broken pack', () => {
  const pack = buildPack();
  pack.cards[0].terms = ['no-such-term'];
  delete pack.title;
  assert.ok(validatePack(pack).length >= 2);
  const pack2 = buildPack();
  pack2.cards[0].story = 'S99';
  assert.ok(validatePack(pack2).some((e) => /unknown story/.test(e)));
});

test('the pack covers the app and states the residual risk', () => {
  const pack = buildPack();
  for (const id of ['authorization-boundary', 'commitment-ledger', 'deny-by-default', 'tool-set', 'residual-risk', 'unbacked-promise', 'prompt-injection', 'handoff-to-human', 'approval-required-tool', 'scripted-planner', 'inert-text', 'audit-log']) assert.ok(pack.glossary.some((g) => g.id === id), id);
  const risk = pack.glossary.find((g) => g.id === 'residual-risk').definition;
  assert.match(risk, /Reply text can still mislead a customer/);
  assert.match(risk, /does not make the text true/);
  assert.deepEqual(pack.sources, []);
  assert.equal(pack.demo.baseUrl, 'http://localhost:5350');
  assert.equal(pack.demo.catalog, 'D31');
});

test('every story says exactly what the UI story strip says', () => {
  const jsx = fs.readFileSync(new URL('../web/src/components/Story.jsx', import.meta.url), 'utf8');
  for (const s of buildPack().stories) {
    assert.ok(jsx.includes(`"${s.title}"`), `Story.jsx does not carry the title of ${s.id}`);
    assert.ok(jsx.includes(`"${s.say}"`), `Story.jsx does not carry the text of ${s.id}`);
  }
});

test('the pack carries no token-shaped value', () => {
  const text = fs.readFileSync(PACK_PATH, 'utf8');
  assert.doesNotMatch(text, /eyJ[A-Za-z0-9_-]{10,}\./);
});

test('a commit is recorded only when passed', () => {
  assert.equal(buildPack().source, undefined);
  assert.equal(buildPack({ commit: 'abc1234' }).source.commit, 'abc1234');
});
