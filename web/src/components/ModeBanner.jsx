import React from "react";

// The simulation banner, first in <main> in every run (UI patterns section 2). The hosted mock build (health.mode === "se-mock")
// keeps its own text; a local run says it is Mock mode and what is simulated. This demo is mock only, so it is never "live".
export const HOSTED_TEXT = "HOSTED SIMULATION. This is the mock-only build on a shared SE cluster: a scripted agent, a mock ledger, no tenant, no model, no network. Everything shown is simulated. Your runs are private to this browser tab.";
export const LOCAL_TEXT = "MOCK MODE. A scripted agent, a mock ledger, no tenant, no model, no network. Everything shown is simulated.";

export default function ModeBanner({ mode }) {
  return <p className="banner pin-top" role="note" data-testid="mode-banner">{mode === "se-mock" ? HOSTED_TEXT : LOCAL_TEXT}</p>;
}
