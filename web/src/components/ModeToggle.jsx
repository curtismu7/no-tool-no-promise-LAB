// Mock / Real switch in the page header. This demo is mock only by design: Real is disabled (the server answers 409)
// and its tooltip carries the server's reason.
export default function ModeToggle({ info, onSelect }) {
  const loading = !info;
  const source = info?.source;
  const realOff = loading || info.realAvailable !== true;
  const reason = realOff && !loading ? info.realReason || "Real mode is not available." : undefined;
  const pick = (next) => { if (next !== source) onSelect?.(next); };
  return (
    <div className="seg" role="group" aria-label="Mode" data-testid="mode">
      <button type="button" className="btn" aria-pressed={source === "mock"} disabled={loading} onClick={() => pick("mock")} data-testid="mode-mock">Mock</button>
      <button type="button" className="btn" aria-pressed={source === "real"} disabled={realOff} title={reason} onClick={() => pick("real")} data-testid="mode-real">Real</button>
    </div>
  );
}
