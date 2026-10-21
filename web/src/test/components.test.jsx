import React from "react";
import { render, screen, within } from "@testing-library/react";
import Column from "../components/Column.jsx";
import Registry from "../components/Registry.jsx";
import { Untrusted } from "../components/Untrusted.jsx";
import { buildSteps } from "../components/Flow.jsx";
import { reveal } from "../lib/reveal.js";
import { governedRun, ledger, registry, reviews, ungovernedRun } from "./fixtures.js";

test("ungoverned column shows a BOUND commitment and no empty-ledger message", () => {
  render(<Column profile="ungoverned" agent={registry.agents[0]} run={ungovernedRun} ledger={ledger} reviews={{ reviews: [], approvals: [] }} />);
  expect(screen.getByTestId("ledger-entries")).toHaveTextContent("BOUND");
  expect(screen.getByTestId("ledger-entries")).toHaveTextContent("cmt-0");
  expect(screen.queryByTestId("ledger-empty")).toBeNull();
  expect(screen.getByText("can bind the company")).toBeInTheDocument();
});

test("governed column shows an empty ledger, the handoff, and the said-not-bound flag", () => {
  render(<Column profile="governed" agent={registry.agents[1]} run={governedRun} ledger={ledger} reviews={reviews} />);
  expect(screen.getByTestId("ledger-empty")).toHaveTextContent("No commitment recorded");
  expect(screen.queryByTestId("ledger-entries")).toBeNull();
  expect(screen.getByTestId("handoffs")).toHaveTextContent("rev-1");
  expect(screen.getByTestId("unbacked-governed")).toHaveTextContent("Said, not bound");
  expect(screen.getByText("cannot bind the company")).toBeInTheDocument();
  expect(screen.getByText(/denied: not in this agent's tool set/)).toBeInTheDocument();
});

test("the registry marks the missing commit tool as absent for the governed agent only", () => {
  render(<Registry registry={registry} />);
  const row = screen.getByText("waive_fee", { selector: "code" }).closest("tr");
  const cells = within(row).getAllByRole("cell");
  expect(cells[1]).toHaveTextContent("in set");
  expect(cells[2]).toHaveTextContent("absent");
  expect(cells[2]).toHaveAttribute("data-absent", "true");
  expect(document.querySelectorAll("[data-absent]")).toHaveLength(1);
});

test("untrusted text is inert: markup is shown as text and hidden characters become visible chips", () => {
  const { container } = render(<Untrusted text={"<img src=x onerror=alert(1)>​hi‮"} />);
  expect(container.querySelector("img")).toBeNull();
  expect(container).toHaveTextContent("<img src=x onerror=alert(1)>");
  const chips = [...container.querySelectorAll(".chip")].map((c) => c.textContent);
  expect(chips).toEqual(["[U+200B]", "[U+202E]"]);
  expect(reveal("a\u0000b")).toBe("a[U+0000]b");
});

test("diagram steps follow the real run: governed has a closed commit path, ungoverned reaches the ledger", () => {
  const gov = buildSteps(governedRun, "governed");
  expect(gov.some((s) => s.nodes.includes("ledger"))).toBe(false);
  expect(gov.map((s) => s.text).join(" ")).toMatch(/1 denied/);
  expect(gov.map((s) => s.text).join(" ")).toMatch(/no commit tool/);
  const un = buildSteps(ungovernedRun, "ungoverned");
  expect(un.some((s) => s.nodes.includes("ledger"))).toBe(true);
  expect(un.map((s) => s.text).join(" ")).toMatch(/wrote 1 commitment/);
  expect(buildSteps(null, "governed")[0].text).toMatch(/Run both/);
});
