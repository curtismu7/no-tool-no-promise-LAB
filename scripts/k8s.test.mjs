// Rule 18 (mock-only SE build): the manifests keep their safety properties. Text checks on the YAML, no cluster, no
// yaml dependency, and deploy.sh is exercised only with --dry-run (a fake kubectl proves it is never called).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = new URL('..', import.meta.url).pathname;
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const FILES = ['k8s/deployment.yaml', 'k8s/service.yaml', 'k8s/ingress.yaml'];
const dep = read('k8s/deployment.yaml');
const ok = { OWNER_APPROVED: '1', NAMESPACE: 'demo-ns', IMAGE: 'registry.example/team/no-tool-no-promise:abc1234', SE_HOST: 'ntnp.demo.example' };
const deployWith = (env, dir = path.join(root, 'k8s')) => spawnSync('bash', [path.join(dir, 'deploy.sh'), '--dry-run'], { cwd: os.tmpdir(), env: { PATH: process.env.PATH, ...env }, encoding: 'utf8' });

test('the deployment is mock-only (MODE=se-mock), hosted on port 5350, non-root, read-only, limited and probed on /api/health', () => {
  for (const re of [/- \{ name: MODE, value: se-mock \}/, /- \{ name: NTNP_BIND, value: "0\.0\.0\.0" \}/, /runAsNonRoot: true/, /runAsUser: 1000/,
    /readOnlyRootFilesystem: true/, /allowPrivilegeEscalation: false/, /privileged: false/, /capabilities: \{ drop: \["ALL"\] \}/,
    /limits: \{ cpu: 500m, memory: 256Mi \}/, /automountServiceAccountToken: false/, /seccompProfile: \{ type: RuntimeDefault \}/, /containerPort: 5350/]) {
    assert.match(dep, re);
  }
  assert.equal((dep.match(/path: \/api\/health/g) || []).length, 2, 'one readiness and one liveness probe');
  assert.equal((dep.match(/readinessProbe:/g) || []).length, 1);
  assert.equal((dep.match(/livenessProbe:/g) || []).length, 1);
  assert.match(dep, /name: Host, value: "127\.0\.0\.1:5350"/, 'probes send a loopback Host the app accepts');
  assert.match(dep, /replicas: 1\b/);
  assert.doesNotMatch(dep, /MODE, value: (local|live|prod|mock)\b/i);
});

test('no hostPath, no privileged container, no host networking, no secret, no service-account token in any manifest', () => {
  for (const f of [...FILES, 'k8s/deploy.sh']) {
    const t = read(f);
    assert.doesNotMatch(t, /hostPath|hostNetwork|hostPID|hostIPC/, f);
    assert.doesNotMatch(t, /privileged:\s*true/, f);
    assert.doesNotMatch(t, /secretKeyRef|secretRef|kind: Secret|password|apiKey|client_secret|(^|\s)token:/i, f);
  }
  assert.match(dep, /automountServiceAccountToken: false/);
});

test('no real host, registry path or tenant sits in the manifests: the only host is the __SE_HOST__ placeholder', () => {
  for (const f of [...FILES, 'k8s/deploy.sh']) {
    assert.doesNotMatch(read(f), /ping-devops|ghcr\.io\/[a-z]|pingidentity|pingone|\.ping[a-z]*\.com/i, f);
  }
  const hosts = [...read('k8s/ingress.yaml').matchAll(/^\s*- host: (\S+)/gm)].map((m) => m[1]);
  assert.deepEqual(hosts, ['__SE_HOST__'], 'the host is supplied by deploy.sh, never defaulted');
});

test('manifests use only the __IMAGE__ and __SE_HOST__ tokens, have no namespace field and no ${...} forms', () => {
  assert.match(dep, /image: __IMAGE__/);
  for (const f of FILES) {
    const t = read(f);
    assert.doesNotMatch(t, /^\s*namespace:/m, f);
    assert.doesNotMatch(t, /\$\{[^}]*\}/, f);
    for (const tok of t.match(/__[A-Z0-9_]+__/g) || []) assert.ok(['__IMAGE__', '__SE_HOST__'].includes(tok), `${f}: ${tok}`);
  }
  assert.doesNotMatch(read('k8s/deploy.sh'), /envsubst/);
});

test('the Service targets the named http port and the Ingress routes to that Service', () => {
  assert.match(read('k8s/service.yaml'), /targetPort: http/);
  assert.match(read('k8s/service.yaml'), /name: no-tool-no-promise/);
  assert.match(read('k8s/ingress.yaml'), /service: \{ name: no-tool-no-promise, port: \{ name: http \} \}/);
  assert.match(read('k8s/ingress.yaml'), /upstream-vhost: "127\.0\.0\.1:5350"/);
});

test('the image runs as the numeric uid the deployment asks for (node is uid 1000 on the base image)', () => {
  assert.match(read('Dockerfile'), /^USER node$/m);
  assert.match(dep, /runAsUser: 1000/);
});

test('deploy.sh refuses without owner approval, a missing value, an immutable-tag failure, or a bad host or namespace', () => {
  assert.equal(deployWith({}).status, 2, 'no approval');
  assert.equal(deployWith({ ...ok, OWNER_APPROVED: '0' }).status, 2);
  for (const k of ['NAMESPACE', 'IMAGE', 'SE_HOST']) {
    const e = { ...ok }; delete e[k];
    assert.notEqual(deployWith(e).status, 0, `missing ${k}`);
  }
  for (const IMAGE of ['registry.example/x:latest', 'registry.example/x:HEAD', 'registry.example/x', 'registry.example/x:', 'registry.example:5000/x', 'reg;rm/x:1', 'reg|x/y:1', 'reg/x:1\nfoo']) {
    assert.equal(deployWith({ ...ok, IMAGE }).status, 2, JSON.stringify(IMAGE));
  }
  for (const SE_HOST of ['Bad Host', 'a|b.example', 'a/b.example', 'a&b.example', 'a\\b.example', 'a.example\nb.example', '']) {
    assert.notEqual(deployWith({ ...ok, SE_HOST }).status, 0, JSON.stringify(SE_HOST));
  }
  for (const NAMESPACE of ['', 'Demo', '-ns', 'ns-', 'a_b', 'a.b', 'a|b', 'ns\nx', 'a'.repeat(64)]) {
    assert.notEqual(deployWith({ ...ok, NAMESPACE }).status, 0, JSON.stringify(NAMESPACE));
  }
});

test('deploy.sh --dry-run renders with valid values, leaves no token, and never calls kubectl', () => {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'ntnp-fakebin-'));
  const marker = path.join(bin, 'called');
  try {
    fs.writeFileSync(path.join(bin, 'kubectl'), `#!/bin/sh\ntouch "${marker}"\nexit 99\n`, { mode: 0o755 });
    const r = spawnSync('bash', [path.join(root, 'k8s', 'deploy.sh'), '--dry-run'], { cwd: os.tmpdir(), env: { PATH: `${bin}:${process.env.PATH}`, ...ok }, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /image: registry\.example\/team\/no-tool-no-promise:abc1234/);
    assert.match(r.stdout, /host: ntnp\.demo\.example/);
    assert.doesNotMatch(r.stdout, /__[A-Z0-9_]+__|\$\{/);
    assert.doesNotMatch(r.stdout, /^\s*namespace:/m);
    assert.equal(fs.existsSync(marker), false, 'kubectl was not called');
  } finally { fs.rmSync(bin, { recursive: true, force: true }); }
});

test('deploy.sh --dry-run fails when a rendered manifest keeps a stray __TOKEN__ (temp copy, tracked files untouched)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ntnp-k8s-copy-'));
  try {
    fs.cpSync(fileURLToPath(new URL('../k8s', import.meta.url)), tmp, { recursive: true });
    fs.appendFileSync(path.join(tmp, 'service.yaml'), '# stray __EXTRA_TOKEN__\n');
    const r = deployWith(ok, tmp);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /__EXTRA_TOKEN__/);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('the rollout is Recreate: a surge pod would split in-memory workspaces across two pods behind one Service', () => {
  assert.match(dep, /^  strategy: \{ type: Recreate \}$/m);
});

test('the hosted image bakes VITE_NTNP_MODE into the web bundle at build time (a build arg, before the web build), and the build is documented', () => {
  const df = read('Dockerfile');
  const arg = df.search(/^ARG VITE_NTNP_MODE$/m);
  assert.ok(arg > 0, 'Dockerfile declares ARG VITE_NTNP_MODE');
  assert.ok(arg < df.indexOf('RUN npm run build -w web'), 'the ARG comes before the web build');
  assert.match(read('docs/k8s.md'), /--build-arg VITE_NTNP_MODE=se-mock/);
});
