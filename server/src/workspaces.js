// Per-visitor workspaces (rule 13), used only in se-mock. One in-memory runtime per workspace id, so one visitor's runs,
// ledger, audit and Reset never touch another's. The id comes from the X-Workspace-Id header. It is a label, not a
// credential: it grants nothing, and a visitor can read another workspace only by guessing its id.
// Capped: past MAX_WORKSPACES the least recently used non-default workspace is dropped. Idle workspaces expire after
// WORKSPACE_TTL_MS (checked on each access; no timer). The default workspace is never evicted.
export const DEFAULT_WORKSPACE = 'default';
export const WORKSPACE_HEADER = 'x-workspace-id';
export const WORKSPACE_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
export const MAX_WORKSPACES = 50;
export const WORKSPACE_TTL_MS = 30 * 60_000;

// undefined header -> 'default'. A valid id -> itself. Anything else (wrong charset, too long, repeated) -> null (refused).
export function resolveWorkspaceId(header) {
  if (header === undefined) return DEFAULT_WORKSPACE;
  return typeof header === 'string' && WORKSPACE_RE.test(header) ? header : null;
}

export function createWorkspaces({ defaultRuntime, create, max = MAX_WORKSPACES, ttlMs = WORKSPACE_TTL_MS, now = () => Date.now() }) {
  // Map keeps insertion order: least recently used first.
  const map = new Map([[DEFAULT_WORKSPACE, { runtime: defaultRuntime, last: now() }]]);
  const expire = (t) => {
    for (const [id, e] of map) if (id !== DEFAULT_WORKSPACE && t - e.last > ttlMs) map.delete(id);
  };
  return {
    get(id = DEFAULT_WORKSPACE) {
      const t = now();
      expire(t);
      const hit = map.get(id);
      if (hit) { hit.last = t; map.delete(id); map.set(id, hit); return hit.runtime; }
      while (map.size >= max) {
        const victim = [...map.keys()].find((k) => k !== DEFAULT_WORKSPACE);
        if (victim === undefined) break;
        map.delete(victim);
      }
      const entry = { runtime: create(), last: t };
      map.set(id, entry);
      return entry.runtime;
    },
    // Returns the workspace's runtime if it exists (and bumps it), else null. Never creates or evicts anything.
    peek(id) {
      const t = now();
      expire(t);
      const hit = map.get(id);
      if (!hit) return null;
      hit.last = t; map.delete(id); map.set(id, hit);
      return hit.runtime;
    },
    size: () => map.size,
    ids: () => [...map.keys()],
  };
}
