// The workspace id for this browser tab (rule 13, hosted build). Random per tab, kept in sessionStorage so a reload keeps
// the same workspace. It is a label, not a credential. The server accepts it only in MODE=se-mock and ignores it locally.
const KEY = "ntnp-workspace";
const PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;
let memo = null;

function randomId() {
  const bytes = new Uint8Array(6);
  globalThis.crypto.getRandomValues(bytes);
  return `ws-${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export function workspaceId() {
  if (memo) return memo;
  try {
    const saved = sessionStorage.getItem(KEY);
    if (saved && PATTERN.test(saved)) return (memo = saved);
  } catch { /* storage blocked: a fresh id for this page load */ }
  memo = randomId();
  try { sessionStorage.setItem(KEY, memo); } catch { /* blocked */ }
  return memo;
}
