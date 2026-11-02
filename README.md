# No tool, no promise LAB

A support chat agent is asked to waive a fee. If it has a tool that can waive fees, it can bind the company. If it has no such tool, it cannot, whatever it is told and whatever it says. This demo runs the same scripted agent twice, with two different tool sets, and shows what the company is actually committed to.

Repo: https://github.com/ping-sandbox/no-tool-no-promise-LAB

- **Ungoverned**: the agent's tool set includes `waive_fee`, `issue_refund` and `change_terms`. A request, or an injected instruction, ends in a commitment on the ledger.
- **Governed**: the tool set is the authorization boundary. The agent can look up policy, hand a request to a human (a review request that commits nothing) and ask for an approval (pending until a human decides; this demo has no approve step). No tool in its set can bind the company, so no run, scenario or request can create a commitment.

Everything is mock. There is no tenant, no LLM and no network: the "agent" is a small deterministic rule-based planner, so runs are reproducible.

**Status: steps ND0 (server core), ND1 (web UI), ND2 (fix pass) and ND3 (packaging).** The UI is served by the server itself. The Docker image was built and run by hand under OrbStack (ND2, and again in ND3 with the checks listed under Verified); no CI runs it and no test starts the container. There is a Learning Hub content pack and a demo-shelf entry (below).

## Words are not commitments, tools are

The boundary is the tool set, not the wording. An agent can still say something misleading. The commitment ledger (what the company is bound to, written only by tools) sits next to the transcript (what was said) because the two can disagree. Run a governed `fee-waiver` with `"wording": "loose"` and the reply says the fee is "as good as gone" while the ledger stays empty: that is flagged `unbackedPromise` (a keyword heuristic, not a guarantee). The boundary stops the system from binding the company; it does not make the reply true. See [docs/safety.md](docs/safety.md).

## Run it

```
npm install
npm test          # server tests, web tests, then docs, compose, content-pack, shelf-entry and k8s manifest checks
npm run doctor    # preflight, exit 1 on any failure
npm run build     # builds web/dist, which the server then serves
npm start         # UI and API at http://127.0.0.1:5350
npm run dev       # Vite dev server on 5360, proxying /api to 5350
npm run content-pack  # regenerates content-pack.json and validates it against docs/content-pack.schema.json
npm run e2e       # headless Chromium run on 5370 (needs npm run build first, and a browser: npx playwright install chromium)
```

Port 5350 by default (`NTNP_PORT`, must be 5350-5399). `MODE` is `local` (the default, this standalone) or `se-mock` (the hosted mock build, see [docs/k8s.md](docs/k8s.md)); any other value is refused. The server binds `127.0.0.1` only; `NTNP_BIND` opts in to another address (the container does, and compose publishes on `127.0.0.1` only).

```
curl -s localhost:5350/api/health
curl -s localhost:5350/api/agents
curl -s -XPOST localhost:5350/api/runs -H 'content-type: application/json' -d '{"scenario":"fee-waiver","profile":"governed"}'
curl -s -XPOST localhost:5350/api/runs -H 'content-type: application/json' -d '{"scenario":"fee-waiver","profile":"ungoverned"}'
curl -s localhost:5350/api/ledger
curl -s localhost:5350/api/audit/verify
```

Docker (OrbStack): `docker compose up --build -d` publishes `127.0.0.1:5350` (`HOST_PORT` changes the host side). Built and run once under OrbStack with `--read-only --cap-drop ALL` (ND2). The compose file's loopback publish is pinned by `scripts/compose.test.mjs`; the running container is not tested automatically.

## The UI

One page, story first. A four-step story strip, then a scenario picker (fee waiver, refund over limit, change of terms, prompt-injected, needs approval) and **Run both**, which sends the same message to the ungoverned and the governed agent. Two columns follow: each has the chat transcript (customer message, tool calls as inert text, agent reply) and, beneath it, the commitment ledger. The ungoverned column shows a recorded commitment; the governed column shows none and the human handoff request. Below: the "words are not commitments, tools are" panel with the residual risk, the per-agent tool registry (the commit tools are visibly absent for the governed agent), a React Flow diagram (customer, agent, tool registry boundary, safe tools and commit tools, ledger) with movable boxes plus Simulate, Reset diagram and a speed control that replay the last real run, and the audit trail with **Verify**. The wording selector `loose` makes the agent over-promise, so you can see a reply that says "done" next to an empty ledger ("Said, not bound", a keyword heuristic). A DEMO badge is always shown (in the hosted build it reads HOSTED SIMULATION, with a banner above the content); dark and light themes; keyboard reachable; every customer or agent string is rendered as text with hidden characters shown as `[U+XXXX]`.

The server serves `web/dist` with a same-origin-only Content-Security-Policy (`default-src 'self'`, no inline script, `connect-src 'self'`). The API keeps `default-src 'none'`.

## API

| Request | What it does |
| --- | --- |
| `GET /api/health` | `demo-health/1` |
| `GET /api/scenarios` | the five scenarios and what each tool set should produce |
| `GET /api/agents` | the per-agent tool registry; tools each agent may call and the ones it is denied |
| `POST /api/runs` | `{ scenario, profile }` plus optional `wording` (`careful` or `loose`) and `message` (up to 500 characters). No other field exists; there is no field that names an agent or a tool |
| `GET /api/runs`, `GET /api/runs/:id` | run summaries; a full run with steps, transcript, reply and analysis |
| `GET /api/ledger` | the commitment ledger (append-only, hash-chained, read-only over HTTP) |
| `GET /api/reviews` | human review requests and pending approvals (neither commits anything) |
| `GET /api/audit`, `GET /api/audit/verify` | the audit log (latest entries, `?limit=1..500`); verification of both hash chains |
| `POST /api/reset` | clears runs, ledger, queues and audit; takes no parameters |

In `MODE=se-mock` every route except `GET /api/health` works inside the workspace named by the `X-Workspace-Id` header (1-32 lowercase letters, digits or hyphens; no header means `default`). The UI sends a random id per tab. Locally the header is ignored and there is one shared state.

Scenarios: `fee-waiver`, `refund-over-limit`, `change-of-terms`, `prompt-injected`, `needs-approval`. Profiles: `ungoverned`, `governed`. In every scenario the governed profile ends with zero commitments; the ungoverned profile commits in all but `needs-approval`, where the tool exists for both agents but only creates a pending approval.

## Packaging

- **Docker**: multi-stage `Dockerfile` (stage 1 builds `web/dist`, stage 2 ships the server and that build, runs as the non-root `node` user, `HEALTHCHECK` on `/api/health`). `docker-compose.yml` publishes `127.0.0.1` only, read-only root, all capabilities dropped, `no-new-privileges`, no volumes, no docker socket, no host network. All pinned by `scripts/compose.test.mjs`.
- **Learning Hub content pack**: `content-pack.json` is generated by `scripts/build-content-pack.mjs` from `content/terms.json` and `content/stories.json` and validated by `scripts/validate-content-pack.mjs` (ajv) against `docs/content-pack.schema.json`. That schema is a copy of the Learning Hub's own (`learning-hub/server/schema/content-pack.schema.json`); only its `$comment` line differs. `scripts/content-pack.test.mjs` fails if the committed file is stale, if the story text differs from the UI, or if the residual-risk statement is dropped. The pack lists no external sources.
- **Hosted mock build (rule 18)**: the same image with `MODE=se-mock`: per-workspace state, live flags refused at startup, a HOSTED SIMULATION banner. `k8s/` holds the Deployment, Service, Ingress (placeholders `__IMAGE__` and `__SE_HOST__`) and `deploy.sh`, which refuses to run without `OWNER_APPROVED=1` and only renders with `--dry-run`. Nothing is deployed from this repo. See [docs/k8s.md](docs/k8s.md).
- **demo-shelf entry**: `docs/shelf-entry.json` (catalog id D31, port 5350). `scripts/lib/shelf-registry-rules.mjs` is a copy of the shelf's validation rules, tested by `scripts/shelf-entry.test.mjs`. Edit `composeFile` to this checkout's absolute path before adding it to the shelf.

## Layout

`server/src` holds the code ([docs/architecture.md](docs/architecture.md)), `server/test` the tests, `scripts/` the doctor, the content-pack and shelf-entry tooling, and the compose and docs checks. Safety rules, each with the test that enforces it, and what is not covered, are in [docs/safety.md](docs/safety.md). Cookie headers are not checked and never read.

## Verified

Only what `npm test`, `npm run doctor`, `npm run e2e` and `npm run content-pack` show. The server was started and queried with curl on port 5350. `npm run e2e` drives headless Chromium through all five scenarios in both profiles. The Docker image was built and run by hand under OrbStack (not by any automated test). No CI exists for this repo, and nothing has been pushed anywhere.

License: MIT.
