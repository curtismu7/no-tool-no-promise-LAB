# Talk track (4 to 6 minutes)

Audience: a customer team asking how to stop an AI agent from promising things the company cannot back. Everything on screen is a mock: a scripted agent, no model, no tenant, no network.

## One-sentence pitch

An agent can only bind the company through a tool that binds the company, so the tool set you give it is the real authorization boundary, not the prompt and not the wording.

## Before you start

`npm run build && npm start`, open http://127.0.0.1:5350, click **Reset**. Confirm the DEMO: mock only badge is visible and both ledgers say empty.

## Live steps

1. **Frame it (30 s).** Point at the four-step story strip and the DEMO badge. Say: "Same agent, same customer message, two different tool sets. We will look at what the company is actually committed to."
2. **Pick the scenario (20 s).** In the Scenario group choose **Fee waiver request**. Read the "Customer will say" line. Leave Agent wording on careful.
3. **Run both (40 s).** Click **Run both**. Say: "Both agents got the identical message. Left is Ungoverned, right is Governed."
4. **Ungoverned column (40 s).** Show the transcript with the tool call `waive_fee` and the ledger entry. Say: "It had a tool that waives fees, so now the company is bound."
5. **Governed column (40 s).** Show the transcript, an empty ledger and the human handoff request. Say: "No tool in its set can bind the company, so it handed the request to a person. Nothing is committed."
6. **Injection (40 s).** Choose **Prompt-injected request**, click **Run both**. Say: "The message tells the agent to call `waive_fee`. The planner is gullible on purpose and tries. The ungoverned one succeeds; the governed one is denied by the registry and the ledger stays empty."
7. **Words are not commitments (50 s).** Set Agent wording to **loose (over-promises)**, choose **Fee waiver request**, click **Run both**. Point at the governed reply that sounds final next to the empty ledger ("Said, not bound"). Then show the **Words are not commitments, tools are** panel. Say: "The boundary stops the system binding the company. It does not make the reply true. That is a separate control."
8. **Registry and diagram (40 s).** Scroll to **Per-agent tool registry**: the commit tools are absent for the governed agent. In **Where the boundary sits**, click **Simulate** to replay the last run; use **Ungoverned** or **Governed** to switch; drag a box; **Reset diagram** restores positions.
9. **Audit (30 s).** In **Audit trail** click **Verify audit trail**. Say: "Both logs are hash chained, so edits are detectable."
10. **Close (10 s).** "If it cannot call it, it cannot promise it. Decide the tool set first."

Optional: **Tool exists but needs human approval** shows a tool present in both sets that only creates a pending approval; this demo has no approve step.

## If asked: honesty lines

- Simulated: the agent (a deterministic rule-based planner, no model), the customer, the tools, the ledger, the data. Nothing leaves this machine.
- UNVERIFIED: any claim about how a particular product enforces tool grants. This demo makes no product claims and cites no sources.
- Not proven: how a real model behaves, that a real deployment is configured this way, that a too-powerful tool in the set is safe, or that a human reviewer approves wisely. The "said, not bound" flag is a keyword heuristic over English templates.

## Likely questions

1. **"Does a better prompt fix this?"** A prompt changes what the agent tries, not what it can do. Here the injected agent tries and is denied by the registry.
2. **"Then is the governed agent safe?"** Safe from binding the company through tools. It can still say something misleading; that needs output review or a human in the loop.
3. **"Is this a real model?"** No. A scripted planner, so runs are reproducible and the boundary is what is being shown.
4. **"Can I change the tool sets or the message?"** The message is editable through the API (up to 500 characters); no request can name an agent or a tool. Tool sets are defined in code.
5. **"Could the ledger be tampered with?"** Over HTTP it is read only, and the hash chain makes edits detectable. Removing entries from the tail leaves a valid shorter chain, so compare the head hash.

## Reset before the next demo

Click **Reset** (or `curl -s -XPOST localhost:5350/api/reset`). It clears runs, ledger, review queues and the audit log; the audit log then starts with a reset entry. Reset the wording back to careful and pick Fee waiver request. Click **Reset diagram** to restore box positions. A server restart also clears everything.
