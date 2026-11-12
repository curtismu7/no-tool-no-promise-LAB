import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../App.jsx";
import { governedRun, ledger, registry, reviews, scenarios, ungovernedRun } from "./fixtures.js";

function mockFetch() {
  const calls = [];
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    calls.push({ url, method: init.method || "GET", body: init.body, headers: init.headers });
    const ok = (b, status = 200) => ({ ok: status < 400, status, json: async () => b });
    if (url === "/api/scenarios") return ok(scenarios);
    if (url === "/api/agents") return ok(registry);
    if (url === "/api/ledger") return ok(ledger);
    if (url === "/api/reviews") return ok(reviews);
    if (url.startsWith("/api/audit/verify")) return ok({ audit: { ok: true, count: 5 }, ledger: { ok: true, count: 1 } });
    if (url.startsWith("/api/audit")) return ok({ entries: [{ seq: 0, type: "run_started", hash: "b".repeat(64) }] });
    if (url === "/api/runs") return ok(JSON.parse(init.body).profile === "governed" ? governedRun : ungovernedRun, 201);
    if (url === "/api/reset") return ok({ ok: true });
    return ok({ error: "x" }, 404);
  });
  return calls;
}

afterEach(() => { vi.restoreAllMocks(); });

test("Run both posts one run per profile, only scenario/profile/wording, to same-origin paths", async () => {
  const calls = mockFetch();
  const user = userEvent.setup();
  render(<App />);
  expect(screen.getByTestId("mode-badge")).toHaveTextContent("DEMO");
  await screen.findByRole("radio", { name: "Fee waiver request" });
  await user.click(screen.getByRole("button", { name: "Run both" }));
  await screen.findByTestId("ledger-entries");
  expect(screen.getByTestId("ledger-empty")).toBeInTheDocument();
  const posts = calls.filter((c) => c.url === "/api/runs");
  expect(posts.map((c) => JSON.parse(c.body))).toEqual([
    { scenario: "fee-waiver", profile: "ungoverned", wording: "careful" },
    { scenario: "fee-waiver", profile: "governed", wording: "careful" },
  ]);
  for (const c of calls) { expect(c.url.startsWith("/api/")).toBe(true); expect(Object.keys(c.headers)).not.toContain("Authorization"); }
  expect(screen.getByTestId("run-status")).toHaveTextContent("Ungoverned recorded 1 commitment; governed recorded 0");
});

test("Verify reports the chain result in a live region", async () => {
  mockFetch();
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole("radio", { name: "Fee waiver request" });
  await user.click(screen.getByRole("button", { name: "Verify audit trail" }));
  await waitFor(() => expect(screen.getByTestId("verify")).toHaveTextContent("Verified"));
  expect(screen.getByTestId("verify")).toHaveAttribute("aria-live", "polite");
});

test("theme toggle switches data-theme", async () => {
  mockFetch();
  const user = userEvent.setup();
  render(<App />);
  await user.selectOptions(screen.getByTestId("theme-select"), "dark");
  expect(document.documentElement.dataset.theme).toBe("dark");
  await user.selectOptions(screen.getByTestId("theme-select"), "auto");
  expect(document.documentElement.dataset.theme).toBeUndefined();
});

test("a server failure is shown, not swallowed", async () => {
  globalThis.fetch = vi.fn(async () => { throw new Error("down"); });
  render(<App />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not reach the server");
});

test("Reset clears both runs from the page and says so", async () => {
  const calls = mockFetch();
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole("radio", { name: "Fee waiver request" });
  await user.click(screen.getByRole("button", { name: "Run both" }));
  await screen.findByTestId("ledger-entries");
  await user.click(screen.getByTestId("reset"));
  await waitFor(() => expect(screen.getAllByText("Pick a scenario and press Run both.")).toHaveLength(2));
  expect(screen.queryByTestId("ledger-entries")).toBeNull();
  expect(screen.getByTestId("run-status")).toHaveTextContent("Reset");
  expect(calls.some((c) => c.url === "/api/reset" && c.method === "POST")).toBe(true);
});

test("if the ledger cannot be fetched after a run, the page does not show an all-clear for the run that committed", async () => {
  mockFetch();
  const base = globalThis.fetch;
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole("radio", { name: "Fee waiver request" });
  // from now on the ledger endpoint answers with an empty ledger, as after a reset in another tab
  globalThis.fetch = vi.fn(async (url, init = {}) => (url === "/api/ledger" ? { ok: true, status: 200, json: async () => ({ count: 0, entries: [] }) } : base(url, init)));
  await user.click(screen.getByRole("button", { name: "Run both" }));
  expect(await screen.findByTestId("ledger-mismatch")).toHaveTextContent("cmt-0");
  expect(screen.getAllByTestId("ledger-empty")).toHaveLength(1);
});
