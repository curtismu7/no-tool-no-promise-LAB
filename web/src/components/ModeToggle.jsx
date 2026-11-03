// Rule 19: the Mock / Real toggle. This app is mock only (no tenant, no model, no network), so Real is always disabled and says why.
// If the server ever reports a live version (realAvailable), Real switches it on through POST /api/mode.
const NO_REAL = "This app has no live version: no tenant, no model, no network. Mock is the whole demo.";

export default function ModeToggle({ info, onSelect }) {
  const loading = !info;
  const source = info?.source;
  const realOff = loading || info?.realAvailable !== true;
  const pick = (next) => { if (next !== source) onSelect?.(next); };
  return (
    <div className="mode-toggle" role="group" aria-label="Mode" data-testid="mode">
      <button type="button" aria-pressed={source === "mock"} disabled={loading} onClick={() => pick("mock")} data-testid="mode-mock">Mock</button>
      <button type="button" aria-pressed={source === "real"} disabled={realOff} title={realOff && !loading ? NO_REAL : undefined} onClick={() => pick("real")} data-testid="mode-real">Real</button>
    </div>
  );
}
