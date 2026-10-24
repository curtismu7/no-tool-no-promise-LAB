# Architecture (step ND0)

```
customer message ──> scripted planner ──> tool call ──> dispatcher ──> handler ──> result
                      (planner.js)                      (toolbox.js)
                                                          │ authorize(agent, tool)   (tools.js: the registry)
                                                          │ validate arguments
                                                          │ append to audit log      (chain.js)
                                                          └ commit tools only: append to the commitment ledger
```

| File | Role |
| --- | --- |
| `server/src/tools.js` | The tool catalog, the two agent identities with their tool sets, `authorize()` (deny by default), argument validation, the boundary invariant. |
| `server/src/toolbox.js` | The handlers and the dispatcher. The only code that writes a commitment. |
| `server/src/chain.js` | A capped, append-only, hash-chained log; `createLedger()` returns a read-only `reader` and a `writer` that only the toolbox receives. |
| `server/src/planner.js` | The deterministic scripted agent and its reply templates. No model, no clock, no randomness. |
| `server/src/config.js` | The `MODE` switch (`local` default, `se-mock`), the live-flag refusal and the doctor check. |
| `server/src/workspaces.js` | Per-visitor workspace registry for `se-mock`: id validation, cap, LRU, TTL. Inventory of all state: [k8s.md](k8s.md). |
| `server/src/scenarios.js` | The five scenarios. |
| `server/src/runtime.js` | In-memory state, the run executor, capacity limits, reset. Exposes read-only views. |
| `server/src/app.js` | Express app, API routes, guards, error handling. Never touches the toolbox or the ledger writer. |
| `server/src/safety.js`, `sanitize.js`, `redaction.js` | Loopback and port rules, Host/Origin/credential guards, inert text, redaction. |
| `server/src/doctor.js`, `health.js` | Preflight checks; `GET /api/health` is refreshed from them in the background. |

## The two agents

Both are the same planner. They differ only in the tool set they are registered with:

- `support-agent-ungoverned`: `lookup_policy`, `create_review_request`, `request_goodwill_credit`, `waive_fee`, `issue_refund`, `change_terms`.
- `support-agent-governed`: `lookup_policy`, `create_review_request`, `request_goodwill_credit`.

Tool kinds: `read`, `handoff` (creates a review request, commits nothing), `approval` (creates a pending approval, commits nothing; the demo has no approve step), `commit` (writes the ledger). A startup and doctor invariant fails if a governed agent holds a tool with `commits: true`.

The planner is gullible on purpose. Given an injected instruction naming a tool, it tries to call it whether or not its set contains it. Whether the call happens is the registry's decision, not the planner's.

## Ledger and audit log

Both are hash chains: each entry holds `seq`, `at`, `prev` (the hash of the entry before) and its own `hash` over its content. `GET /api/audit/verify` recomputes both. Caller data cannot override `seq`, `prev` or `at`. Both are capped (ledger 300, audit 3000); a run is refused with 429 when either is close to full, and `POST /api/reset` clears them (the audit log then starts with a `reset` entry). The ledger has no HTTP write route: `POST /api/runs` is the only way anything happens, and it can only run the scripted agent.

## Limits

200 runs, 300 ledger entries, 3000 audit entries, 200 review requests and 200 approvals, a 4 KB request body, 500 characters of customer message.

## Web UI (step ND1)

`web/` is React + Vite. `web/src/App.jsx` holds the state (scenarios, registry, the last run per profile, ledger, reviews, audit) and talks only to same-origin `/api` through `web/src/lib/api.js`; the only request with a body is `POST /api/runs` with `scenario`, `profile` and `wording`. `components/Column.jsx` draws a transcript and the ledger entries that belong to that run; `Registry.jsx` the tool matrix; `Flow.jsx` the `@xyflow/react` diagram, whose Simulate steps are built from the real run (`buildSteps`); `Audit.jsx` the trail and Verify; `Untrusted.jsx` renders any customer or agent string as text with hidden characters revealed. `server/src/app.js` serves `web/dist` under `UI_CSP`. Tests: vitest and testing-library in `web/src/test`, the static-serving tests in `server/test/ui.test.js` (pinned by two mutations), and `scripts/e2e.mjs` in a real browser.
