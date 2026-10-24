import React from "react";

// Shown only in the hosted mock build (health.mode === "se-mock"). The local standalone shows its own badge instead.
export const HOSTED_TEXT = "HOSTED SIMULATION. This is the mock-only build on a shared SE cluster: a scripted agent, a mock ledger, no tenant, no model, no network. Everything shown is simulated. Your runs are private to this browser tab.";

export default function ModeBanner({ mode }) {
  if (mode !== "se-mock") return null;
  return <p className="hosted" role="note" data-testid="mode-banner">{HOSTED_TEXT}</p>;
}
