import React, { useCallback, useEffect, useState } from "react";
import * as api from "./lib/api.js";
import Story from "./components/Story.jsx";
import Column from "./components/Column.jsx";
import Registry from "./components/Registry.jsx";
import Risk from "./components/Risk.jsx";
import Audit from "./components/Audit.jsx";
import Flow from "./components/Flow.jsx";

const EMPTY_LEDGER = { count: 0, entries: [] };
const EMPTY_REVIEWS = { reviews: [], approvals: [] };

function initialTheme() {
  try { const t = localStorage.getItem("ntnp-theme"); if (t === "dark" || t === "light") return t; } catch { /* blocked */ }
  return globalThis.matchMedia?.("(prefers-color-scheme: dark)")?.matches ? "dark" : "light";
}

export default function App() {
  const [theme, setTheme] = useState(initialTheme);
  const [scenarios, setScenarios] = useState([]);
  const [scenario, setScenario] = useState("fee-waiver");
  const [wording, setWording] = useState("careful");
  const [registry, setRegistry] = useState(null);
  const [runs, setRuns] = useState({});
  const [ledger, setLedger] = useState(EMPTY_LEDGER);
  const [reviews, setReviews] = useState(EMPTY_REVIEWS);
  const [audit, setAudit] = useState(null);
  const [verify, setVerify] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem("ntnp-theme", theme); } catch { /* blocked */ }
  }, [theme]);

  const refresh = useCallback(async () => {
    const [l, r, a] = await Promise.all([api.getLedger(), api.getReviews(), api.getAudit()]);
    setLedger(l); setReviews(r); setAudit(a);
  }, []);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const [s, g] = await Promise.all([api.getScenarios(), api.getAgents()]);
        if (!live) return;
        setScenarios(s.scenarios); setRegistry(g);
        await refresh();
      } catch (e) { if (live) setError(`Could not reach the server: ${e.message}`); }
    })();
    return () => { live = false; };
  }, [refresh]);

  const runBoth = async () => {
    setBusy(true); setError(""); setVerify(null);
    try {
      const un = await api.postRun(scenario, "ungoverned", wording);
      const gov = await api.postRun(scenario, "governed", wording);
      setRuns({ ungoverned: un, governed: gov });
      await refresh();
      setStatus(`Ran "${scenarios.find((s) => s.id === scenario)?.title ?? scenario}". Ungoverned recorded ${un.commitments.length} commitment${un.commitments.length === 1 ? "" : "s"}; governed recorded ${gov.commitments.length}. (${un.id}, ${gov.id})`);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const reset = async () => {
    setBusy(true); setError("");
    try { await api.postReset(); setRuns({}); setVerify(null); await refresh(); setStatus("Reset: runs, ledger and audit cleared."); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const doVerify = async () => {
    setBusy(true);
    try { setVerify(await api.getVerify()); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  const agentOf = (p) => registry?.agents.find((a) => a.profile === p);
  const picked = scenarios.find((s) => s.id === scenario);

  return (
    <>
      <a className="skip" href="#main">Skip to content</a>
      <header className="top">
        <h1>No tool, no promise</h1>
        <span className="mode" data-testid="mode-badge" title="Scripted agent, no model, no tenant, no network">DEMO: mock only</span>
        <p className="tagline">The tool set is the authorization boundary.</p>
        <button type="button" className="btn" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} aria-pressed={theme === "dark"}>
          {theme === "dark" ? "Light theme" : "Dark theme"}
        </button>
      </header>
      <main id="main" className="page" tabIndex={-1}>
        <Story />
        {error && <p className="alert" role="alert">{error}</p>}

        <section className="card picker" aria-labelledby="pick-h">
          <h2 id="pick-h">Scenario</h2>
          <div className="radios" role="radiogroup" aria-label="Scenario">
            {scenarios.map((s) => (
              <label key={s.id} className={scenario === s.id ? "on" : ""}>
                <input type="radio" name="scenario" value={s.id} checked={scenario === s.id} onChange={() => setScenario(s.id)} />
                {s.title}
              </label>
            ))}
          </div>
          {picked && <p className="ask"><span className="muted small">Customer will say:</span> &ldquo;{picked.message}&rdquo;</p>}
          <div className="row">
            <label>Agent wording
              <select value={wording} onChange={(e) => setWording(e.target.value)}>
                <option value="careful">careful</option>
                <option value="loose">loose (over-promises)</option>
              </select>
            </label>
            <button type="button" className="btn primary" onClick={runBoth} disabled={busy || !scenarios.length}>Run both</button>
            <button type="button" className="btn" onClick={reset} disabled={busy}>Reset</button>
          </div>
          <p className="status" role="status" aria-live="polite" data-testid="run-status">{status}</p>
        </section>

        <section className="cols" aria-label="Ungoverned and governed runs side by side">
          <Column profile="ungoverned" agent={agentOf("ungoverned")} run={runs.ungoverned} ledger={ledger} reviews={reviews} />
          <Column profile="governed" agent={agentOf("governed")} run={runs.governed} ledger={ledger} reviews={reviews} />
        </section>

        <Risk />

        <section className="card" aria-labelledby="reg-h">
          <h2 id="reg-h">Per-agent tool registry</h2>
          <Registry registry={registry} />
        </section>

        <section aria-labelledby="flow-h">
          <h2 id="flow-h">Where the boundary sits</h2>
          <Flow runs={runs} theme={theme} />
        </section>

        <section className="card" aria-labelledby="aud-h">
          <h2 id="aud-h">Audit trail</h2>
          <Audit audit={audit} verify={verify} onVerify={doVerify} busy={busy} />
        </section>
        <footer className="small muted">Mock demo. A deterministic scripted planner stands in for the agent; nothing leaves this machine.</footer>
      </main>
    </>
  );
}
