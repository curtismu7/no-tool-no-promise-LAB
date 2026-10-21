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
  const before = document.documentElement.dataset.theme;
  await user.click(screen.getByRole("button", { name: /theme/i }));
  expect(document.documentElement.dataset.theme).not.toBe(before);
});

test("a server failure is shown, not swallowed", async () => {
  globalThis.fetch = vi.fn(async () => { throw new Error("down"); });
  render(<App />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not reach the server");
});
