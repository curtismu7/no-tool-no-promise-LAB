import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import App from "../App.jsx";
import ModeBanner, { HOSTED_TEXT } from "../components/ModeBanner.jsx";
import { workspaceId } from "../lib/workspace.js";
import { governedRun, ledger, registry, reviews, scenarios, ungovernedRun } from "./fixtures.js";

function mockFetch(mode) {
  const calls = [];
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    calls.push({ url, method: init.method || "GET", headers: init.headers || {} });
    const ok = (b, status = 200) => ({ ok: status < 400, status, json: async () => b });
    if (url === "/api/health") return mode ? ok({ schema: "demo-health/1", state: "ready", mode }) : ok({ error: "x" }, 500);
    if (url === "/api/scenarios") return ok(scenarios);
    if (url === "/api/agents") return ok(registry);
    if (url === "/api/ledger") return ok(ledger);
    if (url === "/api/reviews") return ok(reviews);
    if (url.startsWith("/api/audit/verify")) return ok({ audit: { ok: true }, ledger: { ok: true } });
    if (url.startsWith("/api/audit")) return ok({ entries: [] });
    if (url === "/api/runs") return ok(ungovernedRun, 201);
    return ok({ error: "x" }, 404);
  });
  return calls;
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

test("the banner is shown only for the hosted mock build, and says it is simulated", () => {
  const { rerender } = render(<ModeBanner mode="local" />);
  expect(screen.queryByTestId("mode-banner")).toBeNull();
  rerender(<ModeBanner mode="se-mock" />);
  const banner = screen.getByTestId("mode-banner");
  expect(banner).toHaveTextContent("HOSTED SIMULATION");
  expect(banner).toHaveTextContent("Everything shown is simulated");
  expect(banner).toHaveAttribute("role", "note");
  expect(HOSTED_TEXT).toMatch(/private to this browser tab/);
});

test("the page shows the hosted banner and badge when health reports se-mock, and the local badge otherwise", async () => {
  mockFetch("se-mock");
  const { unmount } = render(<App />);
  await screen.findByTestId("mode-banner");
  expect(screen.getByTestId("mode-badge")).toHaveTextContent("HOSTED SIMULATION: mock only");
  expect(screen.getByRole("contentinfo")).toHaveTextContent("Hosted mock build");
  unmount();

  mockFetch("local");
  render(<App />);
  await screen.findByRole("radio", { name: "Fee waiver request" });
  expect(screen.queryByTestId("mode-banner")).toBeNull();
  expect(screen.getByTestId("mode-badge")).toHaveTextContent("DEMO: mock only");
});

test("a build without the hosted mode stays in the local mode when health cannot be read", async () => {
  mockFetch(null);
  render(<App />);
  await screen.findByRole("radio", { name: "Fee waiver request" });
  expect(screen.queryByTestId("mode-banner")).toBeNull();
  expect(screen.getByTestId("mode-badge")).toHaveTextContent("DEMO: mock only");
});

test("a hosted (se-mock) bundle shows the hosted banner and badge even when health cannot be read, and never asks health", async () => {
  vi.stubEnv("VITE_NTNP_MODE", "se-mock");
  const calls = mockFetch(null);
  render(<App />);
  await screen.findByTestId("mode-banner");
  expect(screen.getByTestId("mode-badge")).toHaveTextContent("HOSTED SIMULATION: mock only");
  expect(calls.some((c) => c.url === "/api/health")).toBe(false);
});

test("every API call carries the tab's workspace id, a valid id that stays the same", async () => {
  const calls = mockFetch("se-mock");
  render(<App />);
  await screen.findByTestId("mode-banner");
  const id = workspaceId();
  expect(id).toMatch(/^ws-[0-9a-f]{12}$/);
  expect(workspaceId()).toBe(id);
  const apiCalls = calls.filter((c) => c.url.startsWith("/api/"));
  expect(apiCalls.length).toBeGreaterThan(3);
  for (const c of apiCalls) expect(c.headers["X-Workspace-Id"]).toBe(id);
  expect(calls.every((c) => !Object.keys(c.headers).some((h) => /authorization/i.test(h)))).toBe(true);
});

test("presenter mode keeps the hosted banner and the run controls, and hides the reference sections", async () => {
  mockFetch("se-mock");
  render(<App />);
  await screen.findByTestId("mode-banner");
  expect(screen.getByRole("heading", { name: "Audit trail" })).toBeInTheDocument();
  const toggle = screen.getByRole("button", { name: "Presenter mode" });
  expect(toggle).toHaveAttribute("aria-pressed", "false");
  fireEvent.click(toggle);
  expect(screen.getByRole("button", { name: "Presenter mode" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByTestId("mode-banner")).toHaveTextContent("HOSTED SIMULATION");
  expect(screen.getByRole("button", { name: "Run both" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Audit trail" })).toBeNull();
  expect(screen.queryByRole("heading", { name: "Per-agent tool registry" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Presenter mode" }));
  expect(screen.getByRole("heading", { name: "Audit trail" })).toBeInTheDocument();
});

test("one failed health read is retried, so the hosted banner still shows", async () => {
  mockFetch("se-mock");
  const inner = globalThis.fetch;
  let healthReads = 0;
  globalThis.fetch = vi.fn(async (url, init) => {
    if (url === "/api/health" && healthReads++ === 0) throw new TypeError("network blip");
    return inner(url, init);
  });
  render(<App />);
  await screen.findByTestId("mode-banner", {}, { timeout: 3000 });
  expect(healthReads).toBeGreaterThanOrEqual(2);
  expect(screen.getByTestId("mode-badge")).toHaveTextContent("HOSTED SIMULATION: mock only");
});
