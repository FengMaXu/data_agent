import { describe, expect, it, vi } from 'vitest';
import { dashboardBridgeTarget, handleDashboardMessage } from './dashboardBridge';

const page = (nonce: unknown) => `<html><script>window.__DATA_AGENT_DASHBOARD__=${JSON.stringify({ spec: {}, nonce })};</script></html>`;
const previewUrl = '/api/workspace/download?path=session-1%2Fdashboards%2Fsales.html';

describe('Dashboard refresh bridge', () => {
    it('targets only generated dashboards under dashboards/ with a nonce', () => {
        expect(dashboardBridgeTarget(page('n-1'), previewUrl)).toEqual({ nonce: 'n-1', sessionId: 'session-1', path: 'dashboards/sales.html' });
        expect(dashboardBridgeTarget('<html></html>', previewUrl)).toBeNull();
        expect(dashboardBridgeTarget(page(undefined), previewUrl)).toBeNull();
        expect(dashboardBridgeTarget(page('n-1'), '/api/workspace/download?path=session-1%2Freports%2Fx.html')).toBeNull();
    });

    it('answers the handshake and forwards only the path and view ids', async () => {
        const target = { nonce: 'n-1', sessionId: 'session-1', path: 'dashboards/sales.html' };
        const reply = vi.fn();
        const refresh = vi.fn(async () => ({ datasets: { 'live:p': { columns: [], rows: [] } }, sources: {}, checks: {} }));
        expect(await handleDashboardMessage(target, { kind: 'dashboard.ready', nonce: 'n-1' }, reply, refresh)).toBe(true);
        expect(reply).toHaveBeenLastCalledWith({ kind: 'dashboard.host', nonce: 'n-1' });
        await handleDashboardMessage(target, { kind: 'dashboard.refresh', nonce: 'n-1', requestId: 'r1', viewIds: ['bar'], receiptId: 'forged', sql: 'DROP TABLE t', rows: [[1]] }, reply, refresh);
        expect(refresh).toHaveBeenCalledWith('dashboards/sales.html', ['bar'], 'session-1');
        expect(reply).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'dashboard.refreshed', requestId: 'r1', nonce: 'n-1' }));
    });

    it('ignores other nonces and reports failures by code', async () => {
        const target = { nonce: 'n-1', sessionId: 'session-1', path: 'dashboards/sales.html' };
        const reply = vi.fn();
        expect(await handleDashboardMessage(target, { kind: 'dashboard.refresh', nonce: 'other', requestId: 'r', viewIds: ['bar'] }, reply, vi.fn())).toBe(false);
        expect(reply).not.toHaveBeenCalled();
        await handleDashboardMessage(target, { kind: 'dashboard.refresh', nonce: 'n-1', requestId: 'r2', viewIds: ['bar'] }, reply, async () => { throw new Error('DASHBOARD_VIEW_NOT_LIVE: bar'); });
        expect(reply).toHaveBeenLastCalledWith({ kind: 'dashboard.refresh_error', nonce: 'n-1', requestId: 'r2', code: 'DASHBOARD_VIEW_NOT_LIVE' });
    });
});
