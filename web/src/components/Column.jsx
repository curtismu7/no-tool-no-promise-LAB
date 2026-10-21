import React from "react";
import { Untrusted } from "./Untrusted.jsx";

const DECISION = {
  allowed: ["allowed", "ok"],
  denied: ["denied: not in this agent's tool set", "deny"],
  pending_approval: ["pending human approval", "hold"],
};
const decisionOf = (d) => DECISION[d] || [String(d), "hold"];

export function Transcript({ run }) {
  return (
    <ol className="chat" aria-label="Chat transcript: what was said and which tools were called">
      {run.transcript.map((m, i) => (m.role === "tool" ? (
        <li key={i} className={`msg tool ${decisionOf(m.decision)[1]}`}>
          <span className="who">tool call</span>
          <code><Untrusted text={m.tool} /></code>
          <span className={`tag ${decisionOf(m.decision)[1]}`}>{decisionOf(m.decision)[0]}</span>
          <span className="small"><Untrusted text={m.text} /></span>
        </li>
      ) : (
        <li key={i} className={`msg ${m.role}`}>
          <span className="who">{m.role === "customer" ? "customer" : "agent says"}</span>
          <Untrusted text={m.text} as="p" />
        </li>
      )))}
    </ol>
  );
}

export function Ledger({ run, ledger, profile }) {
  const entries = ledger?.entries ?? [];
  const mine = entries.filter((e) => run.commitments.includes(`cmt-${e.seq}`));
  // The run itself says what it recorded. If the fetched ledger does not show all of it, say so instead of an all-clear.
  const missing = run.commitments.filter((id) => !mine.some((e) => `cmt-${e.seq}` === id));
  const said = run.analysis?.unbackedPromise;
  const state = run.commitments.length ? "bound" : said ? "said" : "free";
  return (
    <section className={`ledger ${state}`} aria-label={`Commitment ledger, ${profile}`}>
      <h4>Commitment ledger <span className="muted small">what the company is bound to</span></h4>
      {missing.length > 0 && (
        <p className="alert" role="alert" data-testid="ledger-mismatch">
          <strong>The ledger view does not match this run.</strong> The run recorded {run.commitments.length} commitment{run.commitments.length === 1 ? "" : "s"} ({missing.join(", ")}) that the fetched ledger does not show. It may be stale or unavailable. Reload before trusting this panel.
        </p>
      )}
      {mine.length === 0 ? (
        missing.length === 0 && (
          <p className="none" data-testid="ledger-empty"><strong>No commitment recorded by any tool.</strong> What the agent said may still be treated as a promise by the customer.</p>
        )
      ) : (
        <ul className="plain" data-testid="ledger-entries">
          {mine.map((e) => (
            <li key={e.seq} className="entry">
              <span className="tag deny">BOUND</span> <code>cmt-{e.seq}</code> <code><Untrusted text={e.action} /></code>
              <span className="small"> {Object.entries(e.details).map(([k, v]) => `${k}=${v}`).join(", ")}</span>
              <span className="small muted"> hash {e.hash.slice(0, 10)}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="small muted">Whole ledger this session: {ledger?.count ?? "unknown"} entr{ledger?.count === 1 ? "y" : "ies"}. Written only by tool handlers; there is no write route.</p>
    </section>
  );
}

export function Handoff({ run, reviews }) {
  const rev = reviews.reviews.filter((r) => r.runId === run.id);
  const apr = reviews.approvals.filter((r) => r.runId === run.id);
  if (!rev.length && !apr.length) return null;
  return (
    <section className="handoff" aria-label="Human handoff requests">
      <h4>Handed to a human <span className="muted small">commits nothing</span></h4>
      <ul className="plain" data-testid="handoffs">
        {rev.map((r) => <li key={r.id}><span className="tag ok">review request</span> <code>{r.id}</code> <span className="small">{r.topic}, {r.status}</span></li>)}
        {apr.map((r) => <li key={r.id}><span className="tag hold">pending approval</span> <code>{r.id}</code> <span className="small">${r.amount}, {r.status}</span></li>)}
      </ul>
    </section>
  );
}

export default function Column({ profile, agent, run, ledger, reviews }) {
  const governed = profile === "governed";
  return (
    <article className={`col ${profile}`} data-testid={`col-${profile}`} aria-labelledby={`h-${profile}`}>
      <header>
        <h3 id={`h-${profile}`}>{governed ? "Governed" : "Ungoverned"}</h3>
        <p className="small muted">{agent ? agent.description : ""}</p>
        {agent && <p className="small"><code>{agent.tools.length} tools</code> {agent.canCommitCompany ? <span className="tag deny">can bind the company</span> : <span className="tag ok">cannot bind the company</span>}</p>}
      </header>
      {!run ? <p className="empty muted">Pick a scenario and press Run both.</p> : (
        <>
          <Transcript run={run} />
          {run.analysis.unbackedPromise && (
            <p className="flag" data-testid={`unbacked-${profile}`} role="note">
              <strong>Said, not bound.</strong> The reply uses promise language but nothing was recorded. The ledger is the truth; the wording is not.
            </p>
          )}
          {run.analysis.promiseLanguage && run.analysis.commitmentsMade > 0 && (
            <p className="flag back" role="note"><strong>Said and bound.</strong> The promise is backed by a recorded commitment, because the agent held a tool that commits.</p>
          )}
          <Ledger run={run} ledger={ledger} profile={profile} />
          <Handoff run={run} reviews={reviews} />
        </>
      )}
    </article>
  );
}
