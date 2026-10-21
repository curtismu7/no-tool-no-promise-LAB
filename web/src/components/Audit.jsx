import React from "react";
import { Untrusted } from "./Untrusted.jsx";

const short = (h) => (h ? String(h).slice(0, 10) : "none");

export default function Audit({ audit, verify, onVerify, busy }) {
  const entries = audit?.entries ?? [];
  return (
    <div>
      <div className="row">
        <button type="button" className="btn" onClick={onVerify} disabled={busy}>Verify audit trail</button>
        <span className="verify" role="status" aria-live="polite" data-testid="verify">
          {verify ? (verify.audit.ok && verify.ledger.ok
            ? `Verified: audit chain ${verify.audit.count} entries, ledger chain ${verify.ledger.count} entries, hashes link.`
            : "Verification FAILED: a chain does not link.") : "Not verified yet."}
        </span>
      </div>
      <div className="scroll-x" tabIndex={0} role="region" aria-label="Audit entries table, scrollable">
        <table className="audit" data-testid="audit-table">
          <caption className="sr-only">Latest audit entries</caption>
          <thead><tr><th scope="col">#</th><th scope="col">Event</th><th scope="col">Agent</th><th scope="col">Tool</th><th scope="col">Decision</th><th scope="col">Hash</th></tr></thead>
          <tbody>
            {entries.length === 0 && <tr><td colSpan={6} className="muted">No entries yet.</td></tr>}
            {[...entries].reverse().map((e) => (
              <tr key={e.seq} className={e.decision === "denied" ? "denied" : ""}>
                <td>{e.seq}</td><td><Untrusted text={e.type} /></td>
                <td className="small"><Untrusted text={e.agentId ?? e.profile ?? ""} /></td>
                <td><code><Untrusted text={e.tool ?? ""} /></code></td>
                <td>{e.decision ? <span className={`tag ${e.decision === "denied" ? "deny" : e.decision === "allowed" ? "ok" : "hold"}`}>{e.decision}</span> : ""}</td>
                <td><code>{short(e.hash)}</code></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
