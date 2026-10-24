# Safety

This is a mock. It calls no LLM, no tenant and no network. The rules below say what the demo claims, each with the test that enforces it. Run them all with `npm test`.

## The claim, and its limit

**The boundary is the tool set, not the wording.** An agent can only bind the company through a tool that binds the company. The governed agent has none, so nothing it is told or says creates a commitment.

**Residual risk, stated plainly.** Reply text can still mislead a customer. A governed agent can say "consider it done" and the ledger will stay empty: the system is not bound, but the customer has been told something untrue. The tool boundary prevents the system from binding the company; it does not make the text true. This demo flags that case as `unbackedPromise`, using a keyword match over the reply. That is a heuristic: a promise phrased in a way the patterns do not know is not flagged. Controlling what an agent says (output review, constrained templates, a human in the loop for anything contractual) is a separate control from the tool boundary and is not provided here. Also not modelled: a human reviewer approving something they should not, a tool that is in the set but is too powerful, and an attacker who can change the registry.

## Rules and their tests

| Rule | Enforced by |
| --- | --- |
| Deny by default: an unknown agent, an unknown tool and a tool outside the agent's set are denied. Names are matched exactly; `__proto__`, `constructor`, `toString`, other-case, padded and hidden-character names are all unknown. | `server/test/boundary.test.js`: "deny by default ...", "the dispatcher: a governed agent calling any commit tool, or a forged name, is denied, audited and writes nothing". |
| The governed tool set holds no commit tool, checked at startup and by the doctor. | `boundary.test.js`: "the governed tool set holds no tool that commits the company ...", "the boundary assertion fails when ...". |
| Through the HTTP API no request shape lets the governed profile create a commitment: forged body fields (`__proto__`, `constructor`, `tools`, `tool`, `agent`, `agentId`, duplicate-looking keys), forged profile and scenario values, non-object bodies, and hostile or injected message text across all scenarios and both wordings. Afterwards the ledger is empty and both chains verify; an ungoverned control run on the same server does commit. | `boundary.test.js`: "through the HTTP API: no request shape lets the governed profile create a commitment". |
| No route writes the ledger or the audit log; `app.js` never references the toolbox or the ledger writer; `commit()` is called only in `toolbox.js` and the writer exists only in `chain.js` and `runtime.js`. | `boundary.test.js`: "no API route can write the ledger ...", "the commitment ledger is writable only through tool handlers (structure)". |
| Tool arguments are validated; unknown keys (including an own `__proto__` key), wrong types and out-of-range values are refused. | `boundary.test.js`: "argument validation ...". |
| Ledger and audit are hash-chained; a changed, removed, reordered or relinked entry is detected; callers cannot set `seq`, `prev` or `at`; the logs are capped. One thing the chain alone cannot show: removing entries from the tail leaves a valid shorter chain, so the head hash the API reports is what to compare. | `boundary.test.js`: "hash chain: ..." (two tests). |
| Runs are capped and refused with 429 at capacity; reset recovers. | `boundary.test.js`: "the runtime refuses a run when it is at capacity ...". |
| Zero non-loopback connections: no socket, DNS lookup or `fetch`, for every scenario, both tool sets and both wordings. The server code imports no network, process or eval facility. | `server/test/safety.test.js`: "every scenario ... zero non-loopback connections ...", "source scan ...", "the guard itself works" (`server/test/netguard.js`). |
| Loopback bind, strict Host guard (421), CSRF guard (`Sec-Fetch-Site: cross-site` and a foreign `Origin` get 403; a body must be `application/json`), credentials refused (400, also on `/api/health`), JSON-only responses with `nosniff` and `default-src 'none'`, a 500 never leaks. | `safety.test.js`. |
| Customer and agent text is inert: hidden and control characters are shown as `[U+XXXX]`, secret-looking strings (JWTs, bearer tokens, `token=...`, URL secrets) are redacted before storage, including a secret split by a hidden character; sizes are bounded. | `server/test/planner.test.js`: "customer text is inert and redacted ...", "hostile tool names are shown inert ...". |
| The scripted planner is deterministic and the two agents differ only in tool set. | `planner.test.js`. |
| Ports are 5350-5399 (tests use 5380-5399, found free at run time). | `safety.test.js`, doctor `port-range`. |
| Hosted build (`MODE=se-mock`): live flags are refused at startup and by the doctor; an unknown MODE is refused; each visitor's workspace is isolated (no read or change across workspaces, hostile ids refused, cap and TTL). | `server/test/mode.test.js`, `server/test/workspace.test.js`; the manifests are checked by `scripts/k8s.test.mjs`. See [k8s.md](k8s.md). |
| The container publishes `127.0.0.1` only, with no mounts, docker socket, host network or privilege. | `scripts/compose.test.mjs` (the image was built and run once by hand; no test runs the container). |
| The checks above are pinned: each is removed from a copy of `src/` and the matching tests must then fail. | `server/test/mutation.test.js` (many mutations, listed in that file, plus an unmutated control; a mutant only counts as killed when a test really fails, not on a timeout or crash). |
| No real credentials in the repo. | `.githooks/pre-commit` runs gitleaks on staged changes. |

## What is not covered

- **Cookie headers are not checked and never read.** Cookies are scoped by host, not port.
- The handlers re-check the grant themselves as a second layer behind the dispatcher. That second layer is not independently pinned by a test (removing it alone changes no observable behaviour), so the dispatcher check is the tested boundary.
- The promise detector is a keyword heuristic over English templates.
- The scripted planner is not an LLM. It shows that a boundary holds against a planner that tries forbidden calls; it does not show how a real model behaves.
- Redaction is pattern based. A secret in a shape no pattern knows, in free text, is not removed.
- State is in memory; a restart clears it. There is no authentication because there is nothing to protect beyond loopback.
- The approval-required tool never completes: there is no approve step in this version.
