// The tool catalog and the per-agent tool registry. This is the authorization boundary.
// Deny by default: an agent may call a tool only if it is in that agent's own tool set. An unknown agent, an unknown
// tool and a tool outside the set are all denied. Names are matched exactly (no case folding, no trimming), and the
// lookups are Map/Set lookups, so "__proto__", "constructor" and "toString" are just unknown names.

const T = (def) => Object.freeze({ ...def, args: Object.freeze(def.args) });
const str = (max, extra = {}) => ({ type: 'string', max, ...extra });
const ACCOUNT = str(12, { pattern: /^ACC-\d{4,6}$/ });

// kind: read (looks something up), handoff (creates a human review request, commits nothing),
//       approval (creates a pending approval, commits nothing until a human decides; this demo has no approve path),
//       commit (binds the company: writes a commitment to the ledger).
export const TOOL_LIST = [
  T({ name: 'lookup_policy', kind: 'read', commits: false, requiresApproval: false,
    description: 'Read the written policy for a topic. Read-only.',
    args: { topic: { ...str(16, { enum: ['fees', 'refunds', 'terms', 'general'] }), required: true } } }),
  T({ name: 'create_review_request', kind: 'handoff', commits: false, requiresApproval: false,
    description: 'Hand a request to a human reviewer. Creates a review request; it grants and promises nothing.',
    args: { topic: { ...str(16, { enum: ['fee_waiver', 'refund', 'terms_change', 'other'] }), required: true }, account_id: { ...ACCOUNT, required: true }, summary: str(200) } }),
  T({ name: 'request_goodwill_credit', kind: 'approval', commits: false, requiresApproval: true,
    description: 'Ask for a goodwill credit. Needs human approval; until a human approves it, nothing is committed.',
    args: { account_id: { ...ACCOUNT, required: true }, amount: { type: 'number', min: 0.01, max: 500, required: true }, reason: str(200) } }),
  T({ name: 'waive_fee', kind: 'commit', commits: true, requiresApproval: false,
    description: 'Waive a fee on an account. COMMITS the company.',
    args: { account_id: { ...ACCOUNT, required: true }, fee_code: { ...str(12, { enum: ['MAINT', 'OVERDRAFT', 'WIRE'] }), required: true }, reason: str(200) } }),
  T({ name: 'issue_refund', kind: 'commit', commits: true, requiresApproval: false,
    description: 'Issue a refund of any amount. COMMITS the company. Has no limit check of its own.',
    args: { account_id: { ...ACCOUNT, required: true }, amount: { type: 'number', min: 0.01, max: 100000, required: true }, reason: str(200) } }),
  T({ name: 'change_terms', kind: 'commit', commits: true, requiresApproval: false,
    description: 'Change a term of the customer agreement. COMMITS the company.',
    args: { account_id: { ...ACCOUNT, required: true }, term: { ...str(16, { enum: ['apr', 'monthly_fee', 'overdraft_limit'] }), required: true }, new_value: { ...str(40, { pattern: /^[\w .%$-]{1,40}$/ }), required: true } } }),
];

const TOOLS = new Map(TOOL_LIST.map((t) => [t.name, t]));

const SHARED = ['lookup_policy', 'create_review_request', 'request_goodwill_credit'];
const AGENT_LIST = [
  { id: 'support-agent-ungoverned', profile: 'ungoverned', label: 'Support agent, ungoverned tool set',
    description: 'Has the tools that bind the company (waive_fee, issue_refund, change_terms) next to the safe ones.',
    tools: [...SHARED, 'waive_fee', 'issue_refund', 'change_terms'] },
  { id: 'support-agent-governed', profile: 'governed', label: 'Support agent, governed tool set',
    description: 'Can look up policy, hand off to a human and request an approval. No tool in its set can bind the company.',
    tools: [...SHARED] },
];
const AGENTS = new Map(AGENT_LIST.map((a) => [a.id, { ...a, tools: new Set(a.tools) }]));
const PROFILES = new Map(AGENT_LIST.map((a) => [a.profile, a.id]));

export const getTool = (name) => (typeof name === 'string' ? TOOLS.get(name) : undefined);
export const agentForProfile = (profile) => (typeof profile === 'string' ? PROFILES.get(profile) : undefined);
export const profileNames = () => [...PROFILES.keys()];
export const agentTools = (agentId) => (typeof agentId === 'string' && AGENTS.has(agentId) ? [...AGENTS.get(agentId).tools] : []);

// The single decision point. Returns { granted, reason }.
export function authorize(agentId, tool) {
  if (typeof agentId !== 'string' || !AGENTS.has(agentId)) return { granted: false, reason: 'unknown_agent' };
  if (typeof tool !== 'string' || !TOOLS.has(tool)) return { granted: false, reason: 'unknown_tool' };
  if (!AGENTS.get(agentId).tools.has(tool)) return { granted: false, reason: 'not_in_tool_set' };
  return { granted: true, reason: 'in_tool_set' };
}
export const isGranted = (agentId, tool) => authorize(agentId, tool).granted;

// Startup and doctor invariant: no agent marked governed holds a tool that commits the company.
export function boundaryViolations({ agents = AGENTS, tools = TOOLS } = {}) {
  const bad = [];
  for (const a of agents.values()) {
    if (a.profile !== 'governed') continue;
    for (const t of a.tools) if (!tools.has(t) || tools.get(t).commits) bad.push(`${a.id} holds ${t}`);
  }
  return bad;
}
export const assertBoundary = (opts) => {
  const bad = boundaryViolations(opts);
  if (bad.length) throw new Error(`tool boundary violated: ${bad.join(', ')}`);
};

// Argument validation against a tool's declared args. Unknown keys (including __proto__) are refused.
export function validateArgs(def, args) {
  if (args === null || typeof args !== 'object' || Array.isArray(args)) return { ok: false, reason: 'bad_args' };
  const proto = Object.getPrototypeOf(args);
  if (proto !== Object.prototype && proto !== null) return { ok: false, reason: 'bad_args' };
  const keys = Object.keys(args);
  if (keys.some((k) => !Object.hasOwn(def.args, k))) return { ok: false, reason: 'bad_args' };
  const out = {};
  for (const [name, spec] of Object.entries(def.args)) {
    const v = args[name];
    if (v === undefined) { if (spec.required) return { ok: false, reason: 'bad_args' }; continue; }
    if (spec.type === 'number') {
      if (typeof v !== 'number' || !Number.isFinite(v) || v < spec.min || v > spec.max) return { ok: false, reason: 'bad_args' };
    } else {
      if (typeof v !== 'string' || v.length > spec.max) return { ok: false, reason: 'bad_args' };
      if (spec.enum && !spec.enum.includes(v)) return { ok: false, reason: 'bad_args' };
      if (spec.pattern && !spec.pattern.test(v)) return { ok: false, reason: 'bad_args' };
    }
    out[name] = v;
  }
  return { ok: true, args: out };
}

export function registryView() {
  const tool = (t) => ({ name: t.name, kind: t.kind, commits: t.commits, requiresApproval: t.requiresApproval, description: t.description });
  return {
    denyByDefault: true,
    rule: 'An agent may call a tool only if it is in that agent\'s own tool set. Everything else is denied and audited.',
    tools: TOOL_LIST.map(tool),
    agents: AGENT_LIST.map((a) => ({
      id: a.id, profile: a.profile, label: a.label, description: a.description,
      tools: a.tools.map((n) => tool(TOOLS.get(n))),
      denied: TOOL_LIST.filter((t) => !a.tools.includes(t.name)).map((t) => t.name),
      canCommitCompany: a.tools.some((n) => TOOLS.get(n).commits),
    })),
  };
}
