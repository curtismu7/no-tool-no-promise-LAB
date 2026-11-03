import React from "react";

// The story in four beats. Fixed text: this demo has one cast and no vertical packs, so the story
// system (the {{cast.*}} token family with a vertical supplying names, as in the sibling demos) is not wired in.
export const STORY = [
  ["A customer asks", "Waive a fee, refund more than the limit, change a term. Maybe the message even tries to give the agent orders."],
  ["The agent plans", "A scripted stub turns the message into tool calls and a reply. No real model, no network, so every run repeats."],
  ["The tool set decides", "Each call is checked against that agent's own tool set. Anything not in the set is denied."],
  ["The ledger records", "Only a tool can bind the company. What was said and what was committed are kept apart."],
];

export default function Story({ active = -1 }) {
  return (
    <ol className="story" aria-label="The story in four steps">
      {STORY.map(([title, text], i) => (
        <li key={title} className={active === i ? "on" : ""} aria-current={active === i ? "step" : undefined}>
          <span className="n">{i + 1}</span>
          <strong>{title}</strong>
          <span>{text}</span>
        </li>
      ))}
    </ol>
  );
}
