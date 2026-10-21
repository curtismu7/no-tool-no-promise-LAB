# Changelog

## 0.1.0 (in progress)

- ND0: server core. Per-agent tool registry (deny by default; governed and ungoverned tool sets), scripted deterministic agent planner, tool handlers (policy lookup, human handoff, approval-required credit, and the three commit tools that exist only in the ungoverned set), hash-chained append-only commitment ledger and audit log, five scenarios, API (`/api/health`, `/api/scenarios`, `/api/agents`, `/api/runs`, `/api/ledger`, `/api/audit`, `/api/audit/verify`, `/api/reviews`, `/api/reset`), doctor, Dockerfile and loopback-published compose (image not built or run yet), gitleaks pre-commit hook, mutation-pinning tests. The web UI is the next step (ND1) and is not built.
- ND1: web UI (React, Vite, @xyflow/react): scenario picker, side-by-side ungoverned and governed columns with transcript and commitment ledger, tool registry, residual-risk panel, diagram with Simulate/Reset/speed, audit trail with Verify, dark and light themes. Server serves `web/dist` with a same-origin-only CSP. `npm run e2e` Playwright run. Dockerfile now builds the UI (not yet built or run).
