// Redaction and inert-text rules, one case per rule. Secrets are assembled at run time so no fixture looks like a
// real credential to a secret scanner. Each rule has its own case that no other rule would also catch.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from './helpers.js';

const { clean, redactText } = await loadSrc('redaction.js');
const san = await loadSrc('sanitize.js');

const j = (...p) => p.join('');
const CASES = [
  ['Bearer', `sent Bearer ${j('abcd', 'efghij')} today`, j('abcd', 'efghij')],
  ['Basic', `sent Basic ${j('dXNlcjpw', 'YXNz')} today`, j('dXNlcjpw', 'YXNz')],
  ['PEM block', j('-----BEGIN ', 'PRIVATE KEY', '-----\nMIIabc123\n-----END ', 'PRIVATE KEY', '-----'), 'MIIabc123'],
  ['PEM block, unterminated', j('-----BEGIN ', 'PRIVATE KEY', '-----\nMIIabc456'), 'MIIabc456'],
  ['AWS AKIA', `id ${j('AK', 'IA', 'ABCDEFGH12345678')} id`, j('AK', 'IA', 'ABCDEFGH12345678')],
  ['AWS ASIA', `id ${j('AS', 'IA', 'ABCDEFGH12345678')} id`, j('AS', 'IA', 'ABCDEFGH12345678')],
  ['sk- key', `key ${j('sk', '-', 'a1b2c3d4e5f6g7h8i9')}`, j('a1b2c3d4e5f6g7h8i9')],
  ['pk_ key', `key ${j('pk', '_', 'a1b2c3d4e5f6g7h8i9')}`, j('a1b2c3d4e5f6g7h8i9')],
  ['ghp_ token', `key ${j('gh', 'p_', 'a1b2c3d4e5f6g7h8i9')}`, j('a1b2c3d4e5f6g7h8i9')],
  ['xoxb token', `key ${j('xo', 'xb-', 'a1b2c3d4e5f6g7h8i9')}`, j('a1b2c3d4e5f6g7h8i9')],
  ['Cookie header', `Cookie: ${j('sid=abc', '123def')}`, j('abc', '123def')],
  ['Set-Cookie header', `Set-Cookie: ${j('sid=zzz', '999')}; Path=/`, j('zzz', '999')],
  ['Authorization header', `Authorization: ${j('Digest realm-', 'xyz987')}`, j('xyz', '987')],
  ['Proxy-Authorization header', `Proxy-Authorization: ${j('Digest realm-', 'pqr654')}`, j('pqr', '654')],
  ['key=value', j('api', '_key=', 'Zq8x7y6w5v'), j('Zq8x7y', '6w5v')],
  ['JSON key: "value"', `{"${j('pass', 'word')}": "${j('Hunter', '2xyz')}"}`, j('Hunter', '2xyz')],
  ['key: value', `${j('sec', 'ret')}: ${j('Plain', 'Value77')}`, j('Plain', 'Value77')],
  ['CLI --flag value', `run --${j('api', '-key')} ${j('Flag', 'Val321')}`, j('Flag', 'Val321')],
  ['URL query parameter', `see https://example.com/p?a=1&${j('signa', 'ture')}=${j('Sig', 'Val123')}&b=2`, j('Sig', 'Val123')],
  ['URL fragment', `see https://example.com/cb#${j('signa', 'ture')}=${j('Frag', 'Sig123')}&state=ok`, j('Frag', 'Sig123')],
  ['URL userinfo password', `see https://bob:${j('Pw', '12345xy')}@example.com/x`, j('Pw', '12345xy')],
  ['URL userinfo name', 'see https://bobby:x@example.com/x', 'bobby'],
  ['JWT-shaped', j('ey', 'Jabcde', '.', 'ey', 'Jfghij', '.', 'sigsig'), j('ey', 'Jabcde')],
];

for (const [name, input, secret] of CASES) {
  test(`redaction rule: ${name} is removed`, () => {
    const out = clean(input);
    assert.ok(!out.includes(secret), `${name}: secret survived in "${out}"`);
    assert.ok(redactText(input) !== input, `${name}: redactText changed nothing`);
  });
}

test('redaction leaves ordinary text alone', () => {
  const plain = 'Please waive my maintenance fee on ACC-1001, thank you.';
  assert.equal(clean(plain), plain);
});

test('redaction runs on the revealed text: a secret split by a separator character is still removed', () => {
  // U+2028 counts as whitespace to a regex, so a pass that ran before the reveal would stop at it and leak the tail.
  const out = clean(`${j('pass', 'word')}=abc defghi`);
  assert.ok(!out.includes('defghi'), out);
  assert.ok(!out.includes('abc'), out);
});

test('hidden characters: the Unicode tag block, both ranges, and lone surrogates are shown, not hidden', () => {
  assert.equal(san.revealText('a\u{E0041}b'), 'a[U+E0041]b');
  assert.equal(san.revealText('a\u{E007F}b'), 'a[U+E007F]b');
  assert.equal(san.revealText('a\u{E0100}b'), 'a[U+E0100]b');
  assert.equal(san.revealText('a\u{E01EF}b'), 'a[U+E01EF]b');
  assert.equal(san.revealText('a\uD800b'), 'a[U+D800]b');
  assert.equal(san.revealText('a\uDFFFb'), 'a[U+DFFF]b');
  assert.equal(san.revealText('a b '), 'a[U+2028]b[U+2029]');
  assert.equal(san.revealText('a\u{1D173}b'), 'a[U+1D173]b');
  assert.equal(san.revealText('a\u{1F600}b'), 'a\u{1F600}b', 'a valid emoji is left alone');
  for (const c of ['\u{E0041}', '\u{E0100}', '\uD800']) assert.equal(san.hasInvisible(`x${c}y`), true);
  assert.equal(san.hasInvisible('plain'), false);
});

test('a tag-character message is shown with visible markers all the way through a run', async () => {
  const { createRuntime } = await loadSrc('runtime.js');
  const rt = createRuntime();
  const r = rt.run({ scenario: 'fee-waiver', profile: 'governed', message: 'waive my fee \u{E0041}\u{E0042}' });
  assert.match(r.message, /\[U\+E0041\]\[U\+E0042\]/);
  assert.match(r.transcript[0].text, /\[U\+E0041\]/);
});

test('stripInvisible removes every hidden character, not just the first', () => {
  assert.equal(san.stripInvisible('​a​b​\u{E0041}c\u{E0041}'), 'abc');
});

test('revealText truncates at max with an ellipsis, and not before', () => {
  assert.equal(san.revealText('x'.repeat(10), 4), 'xxxx…');
  assert.equal(san.revealText('x'.repeat(4), 4), 'xxxx');
  assert.equal(san.revealText('x'.repeat(2000)).length, 2000);
  assert.equal(san.revealText('x'.repeat(2001)).length, 2001);
  assert.ok(san.revealText('x'.repeat(2001)).endsWith('…'));
});
