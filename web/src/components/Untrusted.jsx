import React from "react";
import { reveal } from "../lib/reveal.js";

// Everything a customer or an agent supplies is untrusted. It is only ever rendered as React text nodes (never
// innerHTML), so markup is shown, not run. Hidden characters become visible [U+XXXX] chips.
const CHIP = /(\[U\+[0-9A-F]{4,6}\])/;

export function Untrusted({ text, as: Tag = "span" }) {
  const shown = reveal(text);
  return (
    <Tag className="untrusted" data-testid="untrusted">
      {shown.split(CHIP).map((p, i) => (i % 2
        ? <span key={i} className="chip" title="Hidden character, shown instead of hidden">{p}</span>
        : <React.Fragment key={i}>{p}</React.Fragment>))}
    </Tag>
  );
}
