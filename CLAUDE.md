# CLAUDE.md

No tool, no promise: a Demo-tier app (mock only, no tenant, no LLM, no network). A deterministic scripted support agent runs twice, once with an ungoverned tool set (`waive_fee`, `issue_refund`, `change_terms`) and once with a governed one (no commit tools), next to a hash-chained commitment ledger that only tools can write. The point: the tool set is the authorization boundary, not the wording. See [README.md](README.md) for the full description, API and UI; do not copy it here.

## Commands

```
npm install
npm test             # server (node --test), web (vitest), then scripts/compose, docs, content-pack, shelf-entry tests
npm run build        # builds web/dist, which the server serves
npm run doctor       # preflight, exit 1 on any failure
npm run e2e          # headless Chromium on port 5370; needs a build and: npx playwright install chromium
npm run content-pack # regenerates content-pack.json and validates it against docs/content-pack.schema.json
npm start            # UI and API at http://127.0.0.1:5350
MODE=se-mock npm start  # the hosted mock build: per-tab workspaces, live flags refused (docs/k8s.md)
k8s/deploy.sh --dry-run # renders the SE manifests; the real deploy needs OWNER_APPROVED=1 and is owner-run
npm run dev          # Vite on 5360, proxying /api to 5350
```

Mock/Real: mock only by design. Every page header has a Mock / Real toggle; `GET /api/info` and `POST /api/mode {source}` back it (Real is 409, any switch on the `MODE=se-mock` hosted build is 403). Tests use the test-only `realAvailable` option, never an env var. Details in the README.

Port 5350 (`NTNP_PORT`, must be in 5350-5399; tests use 5380-5399). Docker is OrbStack only, never Docker Desktop: `docker compose up --build -d` publishes `127.0.0.1:5350`.

## Rules that bite here

- Loopback only: bind `127.0.0.1`, strict Host check, Origin/CSRF guard on writes. No real network, no real tenants, no real credentials; the netguard tests assert zero non-loopback connections.
- Customer and agent text is inert (rendered as text, hidden characters shown as `[U+XXXX]`, secrets redacted). Never use `eval`, `Function` or `vm`.
- Test scripts use globs (`node --test test/*.test.js`), never a directory.
- Never use `crypto.generateKeyPairSync` or async `generateKeyPair` (aborted on Node 20 in CI).
- Never parse `node:test` stdout; use the exit code.
- The forbidden-strings scan must print 0: `git log -p --all | grep -cF -f ~/.config/demo-kit/forbidden-strings.txt`. Never print that file. gitleaks runs in `.githooks/pre-commit`.
- `MODE` is `local` (default) or `se-mock`. In se-mock, state is per workspace (`X-Workspace-Id`, see `server/src/workspaces.js`); never add process-wide state for visitor data. Any live flag (`NTNP_LIVE`, `NTNP_LLM_URL`, `NTNP_TENANT`, `NTNP_CREDENTIALS`) is refused in se-mock, and `docs/k8s.md` has the state inventory.
- Mock tokens and values are labelled as mock. Product claims are UNVERIFIED unless sourced; this repo makes none.
- Do not add a route, field or UI path that lets a request name an agent or a tool, or that writes the ledger outside `server/src/toolbox.js`.

## Where the safety claims are pinned

- `server/test/boundary.test.js`: deny by default, no commit tool in the governed set, no HTTP shape creates a governed commitment, ledger writable only via tools, hash chains.
- `server/test/safety.test.js`: loopback, Host/CSRF guards, zero outbound connections, ports.
- `server/test/planner.test.js`: inert and redacted text, deterministic planner.
- `server/test/mutation.test.js`: removes each check from a copy of `src/` and the tests must fail.
- `scripts/compose.test.mjs`: container publishes `127.0.0.1` only. `scripts/docs.test.mjs`: docs match the code.
- `server/test/mode.test.js`, `server/test/workspace.test.js`: MODE refusals, the Mock/Real switch (`GET /api/info`, `POST /api/mode`: 400, 409, 403, both directions), workspace isolation, hostile ids, cap and TTL. `scripts/k8s.test.mjs`: manifests keep their safety properties (text checks, no cluster).
- The table with rule-to-test mapping is [docs/safety.md](docs/safety.md); keep it in step.

## Shelf and content pack

- Shelf: `docs/shelf-entry.json` (catalog id D31, port 5350); set `composeFile` to this checkout's path before adding it. `scripts/shelf-entry.test.mjs` checks it.
- Content pack: edit `content/terms.json` or `content/stories.json`, then `npm run content-pack`, and commit the regenerated `content-pack.json`. A test fails if it is stale.
- Talk track for presenters: [docs/talk-track.md](docs/talk-track.md).
