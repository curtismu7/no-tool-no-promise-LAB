import React from "react";
import { render, screen, within } from "@testing-library/react";
import Column from "../components/Column.jsx";
import Audit from "../components/Audit.jsx";
import Risk from "../components/Risk.jsx";
import Registry from "../components/Registry.jsx";
import { Untrusted } from "../components/Untrusted.jsx";
import { buildSteps } from "../components/Flow.jsx";
import { hasHidden, reveal } from "../lib/reveal.js";
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

const rev = { reviews: [], approvals: [] };
const ledgerOf = (container, profile) => container.querySelector(`section[aria-label="Commitment ledger, ${profile}"]`);

test("the ledger panel never claims the company is free when the run recorded a commitment but the fetched ledger is empty or stale", () => {
  for (const stale of [{ count: 0, entries: [] }, null, undefined]) {
    const { container, unmount } = render(<Column profile="ungoverned" agent={registry.agents[0]} run={ungovernedRun} ledger={stale} reviews={rev} />);
    expect(screen.queryByTestId("ledger-empty")).toBeNull();
    const alert = screen.getByTestId("ledger-mismatch");
    expect(alert).toHaveAttribute("role", "alert");
    expect(alert).toHaveTextContent("cmt-0");
    expect(ledgerOf(container, "ungoverned")).toHaveClass("bound");
    expect(container).not.toHaveTextContent("not bound to anything");
    unmount();
  }
});

test("a consistent ledger shows no mismatch warning", () => {
  render(<Column profile="ungoverned" agent={registry.agents[0]} run={ungovernedRun} ledger={ledger} reviews={rev} />);
  expect(screen.queryByTestId("ledger-mismatch")).toBeNull();
});

test("the empty-ledger copy says no tool recorded a commitment and does not promise the company is safe", () => {
  const { container } = render(<Column profile="governed" agent={registry.agents[1]} run={governedRun} ledger={{ count: 0, entries: [] }} reviews={reviews} />);
  const empty = screen.getByTestId("ledger-empty");
  expect(empty).toHaveTextContent("No commitment recorded by any tool.");
  expect(empty).toHaveTextContent("What the agent said may still be treated as a promise by the customer.");
  expect(container).not.toHaveTextContent("not bound to anything");
  expect(ledgerOf(container, "governed")).toHaveClass("said");
  expect(ledgerOf(container, "governed")).not.toHaveClass("free");
});

test("an empty ledger with no promise language keeps the quiet styling", () => {
  const calm = { ...governedRun, analysis: { promiseLanguage: false, commitmentsMade: 0, unbackedPromise: false } };
  const { container } = render(<Column profile="governed" agent={registry.agents[1]} run={calm} ledger={{ count: 0, entries: [] }} reviews={reviews} />);
  expect(ledgerOf(container, "governed")).toHaveClass("free");
  expect(screen.queryByTestId("unbacked-governed")).toBeNull();
});

test("said and bound: promise language backed by a commitment is flagged as such, and only then", () => {
  const { unmount } = render(<Column profile="ungoverned" agent={registry.agents[0]} run={ungovernedRun} ledger={ledger} reviews={rev} />);
  expect(screen.getByText("Said and bound.")).toBeInTheDocument();
  expect(screen.queryByText("Said, not bound.")).toBeNull();
  unmount();
  render(<Column profile="governed" agent={registry.agents[1]} run={governedRun} ledger={{ count: 0, entries: [] }} reviews={reviews} />);
  expect(screen.queryByText("Said and bound.")).toBeNull();
  expect(screen.getByText("Said, not bound.")).toBeInTheDocument();
});

test("the residual-risk panel states that reply text can still mislead and that the boundary does not make it true", () => {
  const { container } = render(<Risk />);
  expect(container).toHaveTextContent("Reply text can still mislead a customer.");
  expect(container).toHaveTextContent("it does not make the text true");
  expect(container).toHaveTextContent("stops the system from binding the company");
  expect(container).toHaveTextContent("keyword heuristic");
  expect(container).not.toHaveTextContent(/reply text is safe|it makes the text true/i);
});

test("the registry tags commit tools and shows what needs approval", () => {
  const withApproval = { ...registry, tools: [...registry.tools, { name: "request_goodwill_credit", kind: "approval", commits: false, requiresApproval: true, description: "Ask." }],
    agents: registry.agents.map((a) => ({ ...a, tools: [...a.tools, ...(a.profile === "governed" ? [{ name: "request_goodwill_credit", commits: false, requiresApproval: true }] : [])] })) };
  render(<Registry registry={withApproval} />);
  const row = (name) => screen.getByText(name, { selector: "code" }).closest("tr");
  expect(within(row("waive_fee")).getByText("commits")).toBeInTheDocument();
  expect(within(row("lookup_policy")).queryByText("commits")).toBeNull();
  expect(within(row("request_goodwill_credit")).getAllByText(/needs approval/).length).toBeGreaterThan(0);
  expect(within(row("lookup_policy")).queryByText(/needs approval/)).toBeNull();
});

test("the scrollable tables are focusable named regions, so a keyboard user can scroll them", () => {
  const { unmount } = render(<Registry registry={registry} />);
  const reg = screen.getByRole("region", { name: /tool registry/i });
  expect(reg).toHaveAttribute("tabindex", "0");
  expect(reg).toHaveClass("scroll-x");
  unmount();
  render(<Audit audit={{ entries: [] }} verify={null} onVerify={() => {}} busy={false} />);
  const aud = screen.getByRole("region", { name: /audit entries/i });
  expect(aud).toHaveAttribute("tabindex", "0");
});

test("client reveal matches the server: tag characters, separators, surrogates and musical formatting are shown", () => {
  expect(reveal("a\u{E0041}b")).toBe("a[U+E0041]b");
  expect(reveal("a\u{E0100}b")).toBe("a[U+E0100]b");
  expect(reveal("a\u2028b\u2029")).toBe("a[U+2028]b[U+2029]");
  expect(reveal("a\uD800b")).toBe("a[U+D800]b");
  expect(reveal("a\u{1D173}b")).toBe("a[U+1D173]b");
  expect(reveal("a\u{1F600}b")).toBe("a\u{1F600}b");
  expect(hasHidden("x\u{E0041}")).toBe(true);
  expect(hasHidden("plain")).toBe(false);
});
