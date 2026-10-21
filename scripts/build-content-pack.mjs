#!/usr/bin/env node
/**
 * Generates content-pack.json (repo root). Format: docs/content-pack.schema.json (a copy of the Learning Hub schema).
 * Glossary from content/terms.json, stories from content/stories.json (same text as web/src/components/Story.jsx; a test checks that),
 * cards for the app's views. Deterministic: lists sorted by id, 2-space JSON, no timestamps. The git commit is recorded only when
 * passed (--commit=<sha>), so a plain run is reproducible.
 *
 * Sources: none. No public documentation URL is cited in this repo that was verified, so the pack lists none.
 *
 *   node scripts/build-content-pack.mjs [--commit=<sha>]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PACK_PATH = path.join(ROOT, 'content-pack.json');
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

// One page, no deep links, so every card opens the app root.
const CARDS = [
  { id: 'run-both', label: 'Run both tool sets', description: 'Pick a scenario and send the same message to the ungoverned and the governed agent. Compare the ledgers.', group: 'try-it', href: '/', terms: ['commitment-ledger', 'tool-set', 'scripted-planner', 'handoff-to-human'], story: 'S04' },
  { id: 'injection', label: 'Prompt-injected request', description: 'The message orders the agent to call a tool. See it granted for one tool set and denied for the other.', group: 'try-it', href: '/', terms: ['prompt-injection', 'deny-by-default', 'audit-log'], story: 'S03' },
  { id: 'approval', label: 'A tool that needs approval', description: 'A goodwill credit exists for both agents but only creates a pending approval.', group: 'try-it', href: '/', terms: ['approval-required-tool'], story: 'S03' },
  { id: 'words-vs-tools', label: 'Words are not commitments, tools are', description: 'What the boundary does and the residual risk: reply text can still mislead a customer.', group: 'concept', href: '/', terms: ['residual-risk', 'unbacked-promise', 'authorization-boundary', 'inert-text'], story: 'S04' },
  { id: 'registry', label: 'Per-agent tool registry', description: 'Which tools each agent identity may call. The commit tools are absent for the governed agent.', group: 'reference', href: '/', terms: ['tool-set', 'deny-by-default'], story: 'S03' },
];

export function buildPack({ commit } = {}) {
  const pkg = readJson('package.json');
  const stories = readJson('content/stories.json').sort(byId);
  const ids = new Set(stories.map((s) => s.id));
  const pack = {
    schema: 'demo-content-pack/1',
    id: 'no-tool-no-promise',
    title: 'No tool, no promise',
    version: pkg.version,
    ...(commit ? { source: { repo: 'no-tool-no-promise', commit } } : {}),
    demo: { id: 'no-tool-no-promise', name: 'No tool, no promise', catalog: 'D31', baseUrl: 'http://localhost:5350', doctor: '/api/health', tags: ['agent', 'tool-set', 'authorization', 'commitment'] },
    glossary: readJson('content/terms.json').sort(byId),
    sources: [],
    cards: CARDS.map(({ href, ...c }) => ({ ...c, action: { type: 'route', href } })).sort(byId),
    diagrams: [{ id: 'boundary', label: 'Customer, agent, tool registry boundary, ledger', href: '/' }],
    stories,
  };
  for (const c of pack.cards) if (c.story && !ids.has(c.story)) throw new Error(`card ${c.id} names unknown story ${c.story}`);
  return pack;
}

export const serialize = (pack) => `${JSON.stringify(pack, null, 2)}\n`;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const commit = process.argv.find((a) => a.startsWith('--commit='))?.slice(9);
  fs.writeFileSync(PACK_PATH, serialize(buildPack({ commit })));
  console.log(`wrote ${path.relative(process.cwd(), PACK_PATH) || PACK_PATH}`);
}
