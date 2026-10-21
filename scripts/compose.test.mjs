import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

// Every published port must be bound to loopback on the host. A small line parser (no YAML dependency):
// the list items under each `ports:` key.
export function publishedPorts(text) {
  const out = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)ports:\s*$/.exec(lines[i]);
    if (!m) continue;
    for (let j = i + 1; j < lines.length; j++) {
      const item = /^\s*-\s*["']?([^"'\s#]+)["']?/.exec(lines[j]);
      if (!item || lines[j].search(/\S/) <= m[1].length) break;
      out.push(item[1]);
    }
  }
  return out;
}

const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const code = (f) => read(f).split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');

test('docker-compose.yml publishes only on 127.0.0.1, in 5350-5399', () => {
  const ports = publishedPorts(read('docker-compose.yml'));
  assert.ok(ports.length > 0, 'the parser found the published port');
  for (const p of ports) {
    assert.match(p, /^127\.0\.0\.1:/, `${p} must start with 127.0.0.1:`);
    for (const n of p.replace(/^127\.0\.0\.1:/, '').match(/\d+/g).map(Number)) assert.ok(n >= 5350 && n <= 5399, `${p}: port ${n} outside 5350-5399`);
  }
});

test('the parser flags an unbound or wildcard publish', () => {
  for (const bad of ['- "5350:5350"', '- "0.0.0.0:5350:5350"', '- 5350']) {
    const ports = publishedPorts(`services:\n  a:\n    ports:\n      ${bad}\n`);
    assert.equal(ports.length, 1);
    assert.doesNotMatch(ports[0], /^127\.0\.0\.1:/);
  }
});

test('compose gives the container no host access: no mounts, docker socket, host network or privilege', () => {
  const c = code('docker-compose.yml');
  assert.doesNotMatch(c, /^\s*volumes:/m);
  assert.doesNotMatch(c, /docker\.sock|network_mode|privileged|pid:\s*host/);
  assert.match(c, /read_only:\s*true/);
  assert.match(c, /cap_drop:\s*\[ALL\]/);
  assert.match(c, /security_opt:\s*\["no-new-privileges:true"\]/);
  assert.match(c, /\/api\/health/);
});

test('the Dockerfile runs as non-root, ships the server and the built UI only, and binds 0.0.0.0 only through the NTNP_BIND opt-in', () => {
  const df = code('Dockerfile');
  assert.match(df, /^USER node$/m);
  assert.match(df, /NTNP_BIND=0\.0\.0\.0/);
  assert.match(df, /EXPOSE 5350/);
  assert.doesNotMatch(df, /docker-cli|lsof|procps/);
});
