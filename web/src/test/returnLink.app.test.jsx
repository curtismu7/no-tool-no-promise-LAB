// Opened from Customer Agent LAB: the strip and the header Back button show; nothing is preselected.
import React from "react";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { cleanup, render, screen } from "@testing-library/react";
import App from "../App.jsx";
import { returnLinkFor } from "../return-link/returnTargets.js";
import { ledger, registry, reviews, scenarios } from "./fixtures.js";

function mockFetch(mode) {
  globalThis.fetch = vi.fn(async (url) => {
    const ok = (b, status = 200) => ({ ok: status < 400, status, json: async () => b });
    if (url === "/api/health") return mode ? ok({ schema: "demo-health/1", state: "ready", mode }) : ok({ error: "x" }, 500);
    if (url === "/api/scenarios") return ok(scenarios);
    if (url === "/api/agents") return ok(registry);
    if (url === "/api/ledger") return ok(ledger);
    if (url === "/api/reviews") return ok(reviews);
    if (url.startsWith("/api/audit/verify")) return ok({ audit: { ok: true }, ledger: { ok: true } });
    if (url.startsWith("/api/audit")) return ok({ entries: [] });
    return ok({ error: "x" }, 404);
  });
}

const NOTE = { name: "Opened from Customer Agent LAB" };
afterEach(() => { cleanup(); vi.restoreAllMocks(); window.history.replaceState(null, "", "/"); });

describe("return link", () => {
  it("the vendored files match return-link.sha256, which names the parent commit", () => {
    const dir = path.join(process.cwd(), "src", "return-link");
    const text = fs.readFileSync(path.join(dir, "return-link.sha256"), "utf8");
    expect(text.split("\n")[0]).toMatch(/^# vendored byte for byte from curtismu7\/AI-DEMO-Standalone shared\/return-link at [0-9a-f]{7,40}/);
    const pins = text.split("\n").filter((l) => l && !l.startsWith("#")).map((l) => l.split(/\s+/));
    expect(pins.map(([, f]) => f).sort()).toEqual(["ReturnLink.jsx", "ReturnLink.test.jsx", "returnTargets.js"]);
    for (const [h, f] of pins) expect(createHash("sha256").update(fs.readFileSync(path.join(dir, f))).digest("hex"), f).toBe(h);
  });

  it("?from=customer-agent: strip at the top of the page (no hosted banner locally), header Back in the header", async () => {
    mockFetch("local");
    window.history.replaceState(null, "", "/?from=customer-agent&uc=UC28&vertical=banking");
    render(<App />);
    const note = await screen.findByRole("note", NOTE);
    expect(note.textContent).toContain("UC28");
    expect(document.querySelector("main#main").firstElementChild).toBe(note);
    expect(document.querySelector("header.top > button.return-link--header")).not.toBeNull();
    expect(screen.getAllByRole("button", { name: /Back to Customer Agent LAB/ })).toHaveLength(2);
  });

  it("hosted mock: the simulation banner stays first, the strip is right below it", async () => {
    mockFetch("se-mock");
    window.history.replaceState(null, "", "/?from=customer-agent&uc=UC28");
    render(<App />);
    const banner = await screen.findByTestId("mode-banner");
    expect(banner.nextElementSibling).toBe(screen.getByRole("note", NOTE));
  });

  it("no from, an unknown from or a bad id: no strip, no button", async () => {
    for (const q of ["/", "/?from=elsewhere&uc=UC28", "/?from=customer-agent&uc=%3Cb%3E", "/?from=customer-agent&uc=UC28&vertical=a%20b"]) {
      mockFetch("local");
      window.history.replaceState(null, "", q);
      render(<App />);
      await screen.findByRole("radio", { name: "Fee waiver request" });
      expect(screen.queryByRole("button", { name: /Back to/ })).toBeNull();
      expect(screen.queryByRole("note", NOTE)).toBeNull();
      cleanup();
    }
  });

  it("Back goes to the proxy path behind the lab proxy, to the direct URL on the app's own port", () => {
    window.history.replaceState(null, "", "/no-tool-no-promise/?from=customer-agent&uc=UC28");
    expect(returnLinkFor("no-tool-no-promise").href).toBe("/customer-agent/?returned=no-tool-no-promise&uc=UC28");
    window.history.replaceState(null, "", "/?from=customer-agent&uc=UC28");
    expect(returnLinkFor("no-tool-no-promise").href).toBe("http://127.0.0.1:5603/?returned=no-tool-no-promise&uc=UC28");
  });
});

  it("?from=ai-demo-standalone: strip names AI Demo Standalone, Back goes to /ai-demo-standalone/ under the proxy", () => {
    window.history.replaceState(null, "", "/no-tool-no-promise/?from=ai-demo-standalone&uc=UC12");
    expect(returnLinkFor("no-tool-no-promise").href).toBe("/ai-demo-standalone/?returned=no-tool-no-promise&uc=UC12");
  });
