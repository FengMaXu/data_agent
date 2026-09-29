/**
 * App side of the dashboard refresh bridge (ADR-0010). A dashboard page may ask
 * to refresh named views; the app answers only a page whose nonce matches the
 * file it opened, and sends the Runtime nothing but that file's path and the
 * view ids. Rows, Receipts and SQL from the page are never used.
 */

export interface DashboardBridgeTarget {
    readonly nonce: string;
    readonly sessionId: string;
    /** Workspace-relative within the session, e.g. "dashboards/sales.html". */
    readonly path: string;
}

export interface DashboardRefreshAnswer {
    readonly datasets: unknown;
    readonly sources: unknown;
    readonly checks: unknown;
}

const PAYLOAD = /window\.__DATA_AGENT_DASHBOARD__=(\{[\s\S]*?\});<\/script>/;

/** The dashboard behind a preview, if the HTML is one this app generated with a refresh nonce. */
export function dashboardBridgeTarget(html: string, previewUrl: string): DashboardBridgeTarget | null {
    const match = PAYLOAD.exec(html);
    if (!match) return null;
    let nonce: unknown;
    try {
        nonce = (JSON.parse(match[1]!) as { nonce?: unknown }).nonce;
    } catch {
        return null;
    }
    if (typeof nonce !== 'string' || !nonce) return null;
    let workspacePath = '';
    try {
        workspacePath = new URL(previewUrl, 'http://preview.invalid').searchParams.get('path') || '';
    } catch {
        return null;
    }
    // Preview paths are "<sessionId>/dashboards/<name>.html".
    const [sessionId, ...rest] = workspacePath.split('/');
    const path = rest.join('/');
    if (!sessionId || !/^dashboards\/[^/]+\.html$/.test(path)) return null;
    return { nonce, sessionId, path };
}

/**
 * Answer one message from the previewed page. Returns false when the message is
 * not for this bridge, so the caller can handle it otherwise.
 */
export async function handleDashboardMessage(
    target: DashboardBridgeTarget,
    data: Record<string, unknown>,
    reply: (message: Record<string, unknown>) => void,
    refresh: (path: string, viewIds: string[], sessionId: string) => Promise<DashboardRefreshAnswer>,
): Promise<boolean> {
    if (data.nonce !== target.nonce) return false;
    if (data.kind === 'dashboard.ready') {
        reply({ kind: 'dashboard.host', nonce: target.nonce });
        return true;
    }
    if (data.kind !== 'dashboard.refresh') return false;
    const requestId = typeof data.requestId === 'string' ? data.requestId : '';
    const viewIds = Array.isArray(data.viewIds) ? data.viewIds.filter((id): id is string => typeof id === 'string' && id.length > 0) : [];
    if (!requestId || viewIds.length === 0) return true;
    try {
        const answer = await refresh(target.path, viewIds, target.sessionId);
        reply({ kind: 'dashboard.refreshed', nonce: target.nonce, requestId, datasets: answer.datasets, sources: answer.sources, checks: answer.checks });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        reply({ kind: 'dashboard.refresh_error', nonce: target.nonce, requestId, code: /^[A-Z][A-Z_]+/.exec(message)?.[0] ?? 'REFRESH_FAILED' });
    }
    return true;
}
