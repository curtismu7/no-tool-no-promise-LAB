# Hosted mock build on the SE cluster (rule 18)

This is the same image as the local standalone, run with `MODE=se-mock`. It is mock only: a scripted agent, a mock
ledger, no tenant, no model, no network. Each browser tab gets its own workspace, so one visitor's runs, Reset and
ledger never reach another's. The page says "HOSTED SIMULATION" in the badge and in a banner above the content.

Nothing in this repo deploys anything. `k8s/deploy.sh --dry-run` renders the manifests and needs no cluster. The first
real deploy to the SE cluster is owner-approved.

## What the files are

| File | What it does |
| --- | --- |
| `k8s/deployment.yaml` | One replica, `MODE=se-mock`, port 5350, `/api/health` readiness and liveness probes (with a loopback Host header), non-root uid 1000, read-only root filesystem, all capabilities dropped, no privilege escalation, a 16 MiB `/tmp`, CPU and memory limits, no service-account token. |
| `k8s/service.yaml` | ClusterIP Service on port 80 to the named `http` port. |
| `k8s/ingress.yaml` | Routes `__SE_HOST__` to the Service. No TLS section (the owner decides). See "Residual risks" for the header rewrites. |
| `k8s/deploy.sh` | Validates `OWNER_APPROVED`, `IMAGE` (explicit tag, no `latest`/`HEAD`), `SE_HOST` and `NAMESPACE`, renders `__IMAGE__` and `__SE_HOST__` with sed, refuses any left-over `__TOKEN__`, and only then applies with `kubectl -n "$NAMESPACE"`. `--dry-run` stops before kubectl. |
| `scripts/k8s.test.mjs` | Text checks on the manifests and the script (run by `npm test`). It never calls kubectl. |

The manifests contain no namespace, no real host, no registry path, no secret and no tenant id. The placeholders are
`__IMAGE__` and `__SE_HOST__`, filled by `deploy.sh`.

## How the owner deploys (after approval)

1. Build and push the image from a clean checkout with an immutable tag (the git SHA). Do not use `latest`. Build it with
   `docker build --build-arg VITE_NTNP_MODE=se-mock`, so the bundle is hosted-only and does not depend on health.
2. Dry run, and read the output:
   `OWNER_APPROVED=1 NAMESPACE=<ns> IMAGE=<registry>/<repo>/no-tool-no-promise:<sha> SE_HOST=<host> k8s/deploy.sh --dry-run`
3. Deploy: the same command without `--dry-run`. It runs `kubectl apply -n "$NAMESPACE"` and waits for the rollout.
4. Verify by content, not by status code: `GET /api/health` must return `"mode":"se-mock"` and `"state":"ready"`. Check
   that the registry manifest digest and the pod's imageID match `IMAGE`.
5. Browser proof: open the page, run both sides of a scenario, and check the banner and that a second tab starts empty.
   Only then hand over the full `https://` URL.

Set `SE_HOST` to the host the SE team agreed. `NAMESPACE` has no default because the namespace is an owner decision.

## Mode switch

`MODE` is read once at startup (`server/src/config.js`).

| Value | Behaviour |
| --- | --- |
| unset or empty | `local`: the standalone. One process-wide state, the `X-Workspace-Id` header is ignored, behaviour unchanged. |
| `se-mock` | Hosted mock build: per-workspace state, the header is required to be valid when present, and live flags are refused. |
| anything else | Refused at startup and by `npm run doctor` (`mode` check fails). No silent fallback. |

## What is compiled out or refused

This codebase has no live feature: no tenant client, no model client, no outbound request and no credential handling
exists in the server or the UI. So "compiled out" is literally true, and the refusal below is the guard for anyone who
tries to turn a live path on in the hosted build.

- **Refused in `se-mock` (startup and doctor fail):** any non-empty `NTNP_LIVE`, `NTNP_LLM_URL`, `NTNP_TENANT` or
  `NTNP_CREDENTIALS`. The names are reserved so that a hosted build given one by mistake stops loudly. They are not read
  by any local code.
- **Refused in every mode:** a non-loopback bind without `NTNP_BIND` (the container sets it on purpose), a Host that is
  not loopback (421), a cross-site or foreign-origin write (403), a credential header (400), and a workspace id outside
  `^[a-z0-9][a-z0-9-]{0,31}$` or repeated (400 `bad_workspace`, no workspace is created).
- **Not offered in `se-mock`:** nothing additional. Reset, runs, reviews, audit and the ledger all work, but only inside
  the visitor's own workspace.

## Workspace isolation

- The id comes from `X-Workspace-Id`. The UI generates a random `ws-<12 hex>` per tab and keeps it in `sessionStorage`
  (a reload keeps it; a new tab gets a new one). A request without the header uses the `default` workspace.
- One runtime per workspace: runs, reviews, approvals, ledger and audit. The health route is the only route that is
  not workspace-scoped, and it returns no visitor data.
- Only `POST /api/runs` allocates a workspace. Other requests (reads, unknown endpoints, Reset) use the workspace if it
  exists, else an empty runtime that is not kept, so a flood of reads cannot evict a visitor's workspace.
- The registry holds at most 50 workspaces (`MAX_WORKSPACES`, default included). Past that, the least recently used
  non-default workspace is dropped. A workspace unused for 30 minutes (`WORKSPACE_TTL_MS`) expires on the next request.
  The default workspace is never evicted.
- `server/test/workspace.test.js` checks that two workspaces cannot read or change each other (runs by id, ledger, audit
  and Reset), that hostile ids are refused, that the cap evicts the least recently used workspace, that TTL expiry
  works, and that local mode ignores the header.

## Global and module-level state (inventory)

Every piece of state the app keeps, and where it lives. Only the runtime is visitor data.

| Where | State | Scope |
| --- | --- | --- |
| `server/src/runtime.js` (`createRuntime`) | runs, reviews, approvals, ledger, audit chain | Per runtime: one per process in local mode, one per workspace in se-mock. Holds all visitor data. |
| `server/src/workspaces.js` (`createWorkspaces`) | map of workspace id to runtime, with last-used times | One registry per app instance. Holds only the runtime references. |
| `server/src/health.js` (`createHealth`) | last doctor result and a 60 s timer | One per process. Holds no visitor data. |
| `server/src/chain.js` (`createChain`, `createLedger`) | entries and head hash | Created inside each runtime. |
| `server/src/tools.js` | tool catalogue, agent tool sets, profile map (module constants) | Static, built on import, never written after that. |
| `server/src/scenarios.js`, `toolbox.js` (`FEES`, `POLICY`), `runtime.js` (`LIMITS`), `app.js` (`UI_CSP`, `API_HEADERS`) | frozen constants | Static. |
| `server/src/planner.js`, `redaction.js`, `sanitize.js`, `safety.js` | regular expressions and pure functions | No state. Global regexes are used only through `matchAll`, which copies them. |
| `web/src/lib/workspace.js` | the tab's workspace id (memoised) and `sessionStorage` key `ntnp-workspace` | Per tab. |
| `web/src/App.jsx` | theme in `localStorage` (`ntnp-theme`), React state for runs, mode and audit | Per browser (theme) and per page (the rest). |

## Residual risks (stated plainly)

- **Ids are labels, not secrets.** The server does not check who owns a workspace. Anyone who knows an id can read and
  change that workspace. Ids from the UI are random (48 bits), so guessing one is not practical, but a leaked id is.
- **Eviction is a denial of state, not of service.** A visitor can push others out of the 50-slot registry by creating
  new workspaces. An evicted visitor starts empty on their next request, and does not see an error.
- **TTL expiry is lazy.** It runs when the server receives a request. A pod that receives no requests keeps its memory.
- **One replica, in memory.** A pod restart or a rollout clears every workspace. More replicas would split a visitor's
  workspace across pods, which is why the replica count is 1.
- **Ingress header rewrites (UNVERIFIED).** The app refuses a browser `Origin` that is not its own loopback origin, so
  `ingress.yaml` rewrites `Host` and sets `Origin` to the pod's loopback origin. This relies on the cluster's ingress
  controller allowing `configuration-snippet` annotations, which is not checked here. It also weakens the `Origin`
  check for requests through this ingress; `Sec-Fetch-Site: cross-site`, which the browser sets, is still refused.
  The owner's browser proof must confirm that the page can run a scenario through the ingress.
- **No TLS is declared.** The ingress has no TLS section and no certificate. The owner decides how the host is served.
- **The base image is not pinned by digest.** `node:22-alpine` is a tag. `deploy.sh` requires an explicit tag for the
  app image, not for the base image.
- **Reply text can still mislead a customer.** This is the same residual as the local demo (see `docs/safety.md`). The
  hosted banner says what is simulated; it does not make a reply true.
- **The banner is sticky on the one page.** The app has no tabs. Presenter mode (a header button) keeps the banner and the
  run controls and hides the reference sections; the banner is shown in both views. A duplicated browser tab may copy
  `sessionStorage` and so share a workspace id (UNVERIFIED in a real browser); the banner's wording says "this browser tab".
- **What was run, and what was not.** Run by hand under OrbStack: `docker build`; the image started with
  `MODE=se-mock` (read-only root, all capabilities dropped) answered `/api/health` with `mode` `se-mock`, the banner text is in
  the served bundle, two workspaces did not see each other, a hostile workspace id got 400, and `NTNP_LIVE=1` or an unknown
  `MODE` each exited 1 at startup. Not run: any cluster contact, `kubectl`, a registry push, or a browser test against the SE host.
