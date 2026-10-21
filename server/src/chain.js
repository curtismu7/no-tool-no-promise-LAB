// A capped, append-only, hash-chained log. Each entry carries the hash of the one before it, so changing, removing or
// reordering any entry is detectable by verifyEntries(). Used for both the commitment ledger and the audit log.
import crypto from 'node:crypto';

export const GENESIS = '0'.repeat(64);
const sortKeys = (v) => {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]));
  return v;
};
export const hashBody = (body) => crypto.createHash('sha256').update(JSON.stringify(sortKeys(body))).digest('hex');

export function verifyEntries(entries) {
  let prev = GENESIS;
  for (let i = 0; i < entries.length; i += 1) {
    const { hash, ...body } = entries[i];
    if (body.seq !== i) return { ok: false, count: entries.length, brokenAt: i, reason: 'bad_sequence' };
    if (body.prev !== prev) return { ok: false, count: entries.length, brokenAt: i, reason: 'bad_link' };
    if (hashBody(body) !== hash) return { ok: false, count: entries.length, brokenAt: i, reason: 'bad_hash' };
    prev = hash;
  }
  return { ok: true, count: entries.length, head: prev };
}

export function createChain({ cap, now = () => new Date() }) {
  const entries = [];
  let head = GENESIS;
  return {
    cap,
    append(data) {
      if (entries.length >= cap) throw Object.assign(new Error('chain_full'), { code: 'chain_full' });
      // data first: it can never override the sequence, time or link fields
      const body = { ...structuredClone(data), seq: entries.length, at: now().toISOString(), prev: head };
      const entry = Object.freeze({ ...body, hash: hashBody(body) });
      entries.push(entry);
      head = entry.hash;
      return structuredClone(entry);
    },
    entries: () => entries.map((e) => structuredClone(e)),
    verify: () => verifyEntries(entries),
    head: () => head,
    size: () => entries.length,
    remaining: () => cap - entries.length,
    clear() { entries.length = 0; head = GENESIS; },
  };
}

// The commitment ledger. What the company is actually bound to. `reader` can only read. `writer.commit` is handed
// to the commit-making tool handlers and to nothing else; `reset` stays with the runtime.
export function createLedger({ cap, now }) {
  const chain = createChain({ cap, now });
  const reader = Object.freeze({
    cap, entries: chain.entries, verify: chain.verify, head: chain.head, size: chain.size, remaining: chain.remaining,
  });
  const writer = Object.freeze({ commit: (data) => chain.append({ ...data, type: 'commitment' }) });
  return { reader, writer, reset: chain.clear };
}
