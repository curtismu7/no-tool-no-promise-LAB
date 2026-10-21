import React from "react";

export default function Risk() {
  return (
    <section className="risk" aria-labelledby="risk-h">
      <h2 id="risk-h">Words are not commitments, tools are</h2>
      <div className="two">
        <div>
          <h3>What the boundary does</h3>
          <p>The agent can only bind the company through a tool, and the governed agent has no such tool in its set. Prompting, wording and injected instructions cannot add one. A call to a tool outside the set is denied and written to the audit log.</p>
        </div>
        <div>
          <h3>What it does not do</h3>
          <p><strong>Reply text can still mislead a customer.</strong> A governed agent can say &ldquo;consider it done&rdquo; and the ledger will stay empty. The boundary stops the system from binding the company; it does not make the text true. Wording rules, review of replies and a real human handoff are separate controls this demo does not claim to provide.</p>
        </div>
      </div>
      <p className="small muted">The &ldquo;Said, not bound&rdquo; flag is a keyword heuristic over the reply, not a guarantee. Everything here is mock: a scripted agent, no model, no tenant, no network.</p>
    </section>
  );
}
