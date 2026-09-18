import { describe, expect, it } from "vitest";
import { handleBridgeMessage, parseBridgeRequest, validateDashboardV4Spec } from "./dashboard-v4.js";

describe("Dashboard V4 semantic", () => {
  it("validates semantic specs", () => {
    const good = validateDashboardV4Spec({ title: "经营看板", views: [{ id: "v1", type: "line", query: "sales by month" }] });
    expect(good.ok).toBe(true);
    const bad = validateDashboardV4Spec({ title: "", views: [{ id: "", type: "gauge", query: "" }] });
    expect(bad.ok).toBe(false);
  });
});

describe("restricted bridge", () => {
  const iframeWindow = { iframe: true };
  const session = { expectedOrigin: "https://dashboards.example", expectedSourceWindow: iframeWindow, sessionId: "s1", nonce: "n0nce" };
  const event = (data: unknown) => ({ source: iframeWindow, origin: "https://dashboards.example", data });

  it("parses allowed kinds only", () => {
    expect(parseBridgeRequest({ kind: "semantic.refresh", nonce: "n0nce", requestId: "r1", parameters: {} }).ok).toBe(true);
    expect(parseBridgeRequest({ kind: "run_python", nonce: "n0nce" }).ok).toBe(false);
    expect(parseBridgeRequest({ kind: "semantic.refresh", requestId: "r1" }).ok).toBe(false);
  });

  it("rejects wrong origin, wrong source window, and nonce mismatch", () => {
    expect(handleBridgeMessage(session, { ...event({ kind: "dashboard.ready", nonce: "n0nce" }), origin: "https://evil.example" }, () => {}).accepted).toBe(false);
    expect(handleBridgeMessage(session, { ...event({ kind: "dashboard.ready", nonce: "n0nce" }), source: { other: 1 } }, () => {}).accepted).toBe(false);
    expect(handleBridgeMessage(session, event({ kind: "dashboard.ready", nonce: "wrong" }), () => {}).accepted).toBe(false);
  });

  it("dispatches a validated semantic.refresh with session identity", async () => {
    let received: any;
    const result = handleBridgeMessage(session, event({ kind: "semantic.refresh", nonce: "n0nce", requestId: "r9", parameters: { month: "1月" } }), (request) => { received = request; });
    expect(result.accepted).toBe(true);
    expect(received.sessionId).toBe("s1");
    expect(received.kind).toBe("semantic.refresh");
  });
});
