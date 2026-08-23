export interface DashboardV4SemanticSpec {
  title: string;
  parameters?: Record<string, { type: "string" | "number" | "date"; default?: unknown }>;
  views: Array<{
    id: string;
    type: "line" | "bar" | "pie" | "kpi" | "table";
    title?: string;
    query: string;
    fieldMapping?: Record<string, string>;
  }>;
}

export function validateDashboardV4Spec(spec: unknown): { ok: true; spec: DashboardV4SemanticSpec } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const s = spec as DashboardV4SemanticSpec;
  if (!s || typeof s !== "object") return { ok: false, errors: ["spec must be an object"] };
  if (typeof s.title !== "string" || !s.title) errors.push("title is required");
  if (!Array.isArray(s.views) || s.views.length === 0) errors.push("at least one view is required");
  else for (const view of s.views) {
    if (!view.id) errors.push("view.id is required");
    if (!["line", "bar", "pie", "kpi", "table"].includes(view.type)) errors.push(`view ${view.id} has unsupported type`);
    if (typeof view.query !== "string" || !view.query.trim()) errors.push(`view ${view.id} needs a semantic query`);
  }
  return errors.length === 0 ? { ok: true, spec: s } : { ok: false, errors };
}

// ─── Restricted postMessage bridge ──────────────────────────────────────────

export type DashboardBridgeRequest =
  | { kind: "dashboard.ready"; nonce: string }
  | { kind: "semantic.refresh"; nonce: string; requestId: string; parameters: Record<string, unknown> }
  | { kind: "semantic.cancel"; nonce: string; requestId: string };

export type DashboardBridgeResponse =
  | { kind: "dashboard.ready"; nonce: string }
  | { kind: "semantic.result"; requestId: string; rows: Array<Record<string, unknown>> }
  | { kind: "semantic.error"; requestId: string; code: string };

const ALLOWED_KINDS = new Set(["dashboard.ready", "semantic.refresh", "semantic.cancel"]);

/** Host-side validator: strict allowlist, no Node access, no arbitrary commands. */
export function parseBridgeRequest(raw: unknown): { ok: true; request: DashboardBridgeRequest } | { ok: false; reason: string } {
  if (!raw || typeof raw !== "object") return { ok: false, reason: "BRIDGE_MESSAGE_MALFORMED" };
  const msg = raw as Record<string, unknown>;
  if (typeof msg.kind !== "string" || !ALLOWED_KINDS.has(msg.kind)) return { ok: false, reason: "BRIDGE_KIND_REJECTED" };
  if (typeof msg.nonce !== "string" || !msg.nonce) return { ok: false, reason: "BRIDGE_NONCE_REQUIRED" };
  if (msg.kind === "dashboard.ready") return { ok: true, request: { kind: "dashboard.ready", nonce: msg.nonce } };
  if (typeof msg.requestId !== "string" || !msg.requestId) return { ok: false, reason: "BRIDGE_REQUEST_ID_REQUIRED" };
  if (msg.kind === "semantic.refresh") {
    if (!msg.parameters || typeof msg.parameters !== "object") return { ok: false, reason: "BRIDGE_PARAMETERS_REQUIRED" };
    return { ok: true, request: { kind: "semantic.refresh", nonce: msg.nonce, requestId: msg.requestId, parameters: msg.parameters as Record<string, unknown> } };
  }
  return { ok: true, request: { kind: "semantic.cancel", nonce: msg.nonce, requestId: msg.requestId } };
}

export interface BridgeSession {
  expectedOrigin: string;
  expectedSourceWindow: unknown;
  sessionId: string;
  nonce: string;
}

/** Renders an embedded semantic dashboard shell: bridge-only, no inline data, no Node. */
export function renderSemanticDashboardHtml(spec: DashboardV4SemanticSpec, options: { nonce: string; expectedOrigin: string }): string {
  const payload = JSON.stringify({ title: spec.title, views: spec.views, parameters: spec.parameters ?? {}, nonce: options.nonce, expectedOrigin: options.expectedOrigin });
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${spec.title}</title></head>
<body><h1>${spec.title}</h1><div id="charts"></div>
<script>window.__SEMANTIC_DASHBOARD__=${payload};
(function(){
  var nonce=window.__SEMANTIC_DASHBOARD__.nonce;
  var hostOrigin=window.__SEMANTIC_DASHBOARD__.expectedOrigin;
  function send(msg){msg.nonce=nonce;window.parent.postMessage(msg,hostOrigin);}
  send({kind:'dashboard.ready'});
  window.addEventListener('message',function(ev){
    if(ev.origin!==hostOrigin)return;
    var d=ev.data||{};
    if(d.kind==='semantic.result'){document.title='updated:'+d.requestId;}
    if(d.kind==='semantic.error'){document.title='error:'+d.requestId;}
  });
})();
</script></body></html>`;
}

/** Validates sender identity before any dispatch; returns the request or rejects. */
export function handleBridgeMessage(
  session: BridgeSession,
  event: { source: unknown; origin: string; data: unknown },
  dispatch: (request: DashboardBridgeRequest & { sessionId: string }) => void,
): { accepted: boolean; reason?: string } {
  if (event.origin !== session.expectedOrigin) return { accepted: false, reason: "BRIDGE_ORIGIN_REJECTED" };
  if (session.expectedSourceWindow !== undefined && event.source !== session.expectedSourceWindow) return { accepted: false, reason: "BRIDGE_SOURCE_REJECTED" };
  const parsed = parseBridgeRequest(event.data);
  if (!parsed.ok) return { accepted: false, reason: parsed.reason };
  if (parsed.request.nonce !== session.nonce) return { accepted: false, reason: "BRIDGE_NONCE_MISMATCH" };
  dispatch({ ...parsed.request, sessionId: session.sessionId });
  return { accepted: true };
}
