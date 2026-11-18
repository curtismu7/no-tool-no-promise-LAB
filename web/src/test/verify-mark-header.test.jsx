import React from "react";
import { render, screen, within } from "@testing-library/react";
import App from "../App.jsx";
import { workspaceId } from "../lib/workspace.js";
import { ledger, registry, reviews, scenarios } from "./fixtures.js";

// The header shows this lab's own Verified / In progress mark, read from the same /api/shelf call the Shelf link makes (through the lab-proxy that
// call reaches the shelf, whose payload lists every demo with its mark). The lab's own /api/shelf has no demos, so there is no mark then.
const mark = (status, label, extra = {}) => ({ status, label, note: "", updatedAt: "2026-11-15", source: "shipped", ...extra });

function mockFetch(shelf) {
  const calls = [];
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    calls.push({ url, headers: init.headers || {}, credentials: init.credentials });
    const ok = (b, status = 200) => ({ ok: status < 400, status, json: async () => b });
    if (url === "/api/shelf") return ok(shelf);
    if (url === "/api/scenarios") return ok(scenarios);
    if (url === "/api/agents") return ok(registry);
    if (url === "/api/ledger") return ok(ledger);
    if (url === "/api/reviews") return ok(reviews);
    if (url.startsWith("/api/audit/verify")) return ok({ audit: { ok: true }, ledger: { ok: true } });
    if (url.startsWith("/api/audit")) return ok({ entries: [] });
    return ok({ error: "x" }, 404);
  });
  return calls;
}

afterEach(() => { vi.restoreAllMocks(); });

test("the header shows this lab's own mark beside the Shelf link, and no other lab's", async () => {
  const calls = mockFetch({ shelfUrl: "http://shelf.example", demos: [
    { id: "other-lab", verification: mark("in-progress", "In progress") },
    { id: "no-tool-no-promise", verification: mark("verified", "Verified", { note: "Every scenario run on the mock" }) },
  ] });
  render(<App />);
  await screen.findByRole("radio", { name: "Fee waiver request" });
  const bar = within(await screen.findByTestId("top-menu"));
  expect(await bar.findByText("Verified")).toBeInTheDocument();
  expect(bar.getByRole("link", { name: "Shelf" })).toBeInTheDocument();
  expect(bar.queryByText("In progress")).toBeNull();
  expect(document.querySelectorAll(".verify")).toHaveLength(1);
  expect(bar.getByText("Verified").closest(".verify")).toHaveAttribute("title", expect.stringContaining("Every scenario run on the mock"));
  // Same request as the Shelf link makes: the per-tab workspace id on every API call, no cookies.
  const shelfCalls = calls.filter((c) => c.url === "/api/shelf");
  expect(shelfCalls.length).toBeGreaterThanOrEqual(1);
  expect(shelfCalls.length).toBeGreaterThanOrEqual(2); // VerifyMark + ShelfLink
  const markCall = calls.find((c) => c.url === "/api/shelf" && c.credentials === "same-origin");
  expect(markCall, "VerifyMark fetches the shelf same-origin (the lab-proxy routing cookie rides along)").toBeTruthy();
  expect(markCall.headers["X-Workspace-Id"]).toBe(workspaceId());
});

test("an In progress mark for this lab shows as In progress", async () => {
  mockFetch({ shelfUrl: "http://shelf.example", demos: [{ id: "no-tool-no-promise", verification: mark("in-progress", "In progress") }] });
  render(<App />);
  const bar = within(await screen.findByTestId("top-menu"));
  expect(await bar.findByText("In progress")).toBeInTheDocument();
  expect(bar.queryByText("Verified")).toBeNull();
});

test("nothing shows when the lab is opened on its own port (its /api/shelf has no demos), the shelf has no mark for it, or the mark is none", async () => {
  for (const shelf of [
    { shelfUrl: "http://shelf.example" },
    { shelfUrl: "http://shelf.example", demos: [{ id: "no-tool-no-promise", verification: null }] },
    { shelfUrl: "http://shelf.example", demos: [{ id: "no-tool-no-promise", verification: mark("none", "") }] },
  ]) {
    mockFetch(shelf);
    const { unmount } = render(<App />);
    const bar = within(await screen.findByTestId("top-menu"));
    expect(await bar.findByRole("link", { name: "Shelf" })).toBeInTheDocument(); // the shelf answered, and still no badge
    expect(document.querySelector(".verify")).toBeNull();
    unmount();
  }
});
