// Thin fetch wrapper. Same-origin only. Only POST /api/runs carries a body (scenario, profile, wording); no headers
// beyond Accept and Content-Type, no credentials: the server refuses them.
async function call(path, method = "GET", body) {
  const init = { method, headers: { Accept: "application/json" } };
  if (body !== undefined) { init.headers["Content-Type"] = "application/json"; init.body = JSON.stringify(body); }
  const res = await fetch(path, init);
  let data = null;
  try { data = await res.json(); } catch { /* not JSON */ }
  if (!res.ok) {
    const err = new Error(data?.message || data?.error || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const getHealth = () => call("/api/health");
export const getScenarios = () => call("/api/scenarios");
export const getAgents = () => call("/api/agents");
export const getLedger = () => call("/api/ledger");
export const getReviews = () => call("/api/reviews");
export const getAudit = () => call("/api/audit?limit=60");
export const getVerify = () => call("/api/audit/verify");
export const postRun = (scenario, profile, wording) => call("/api/runs", "POST", { scenario, profile, wording });
export const postReset = () => call("/api/reset", "POST", {});
