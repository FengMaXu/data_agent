import { describe, expect, it } from 'vitest';
import {
    isWorkspaceRelativePath,
    resolveWorkspaceAssetUrl,
    resolveWorkspaceDownloadUrl,
    resolveWorkspacePreviewUrl,
} from '../resolveInternalUrl';

describe('workspace markdown link resolution', () => {
    it('recognizes session-relative workspace assets', () => {
        expect(isWorkspaceRelativePath('data/industry_sales_2026_h1.csv')).toBe(true);
        expect(isWorkspaceRelativePath('./data/industry_sales_2026_h1.csv')).toBe(true);
        expect(isWorkspaceRelativePath('reports/summary.html')).toBe(true);
        expect(isWorkspaceRelativePath('https://example.com/result.csv')).toBe(false);
        expect(isWorkspaceRelativePath('/data/result.csv')).toBe(false);
    });

    it('converts a relative CSV link to the authenticated download endpoint', () => {
        const url = new URL(resolveWorkspaceDownloadUrl('data/industry_sales_2026_h1.csv', 'session-123'));
        expect(url.pathname).toBe('/api/workspace/download');
        expect(url.searchParams.get('path')).toBe('session-123/data/industry_sales_2026_h1.csv');
    });

    it('converts a relative asset to the authenticated preview endpoint', () => {
        const url = new URL(resolveWorkspacePreviewUrl('data/industry_sales_2026_h1.csv', 'session-123'));
        expect(url.pathname).toBe('/api/workspace/download');
        expect(url.searchParams.get('path')).toBe('session-123/data/industry_sales_2026_h1.csv');
    });

    it('keeps a bare generated image at the workspace root', () => {
        const url = new URL(resolveWorkspaceAssetUrl('chart1_trend.png', undefined, 'session-123'));
        expect(url.searchParams.get('path')).toBe('chart1_trend.png');
    });

    it('uses the Electron workspace protocol instead of file:// HTTP paths', () => {
        window.dataAgentRuntime = { invokeRuntimeCommand: async () => ({}), subscribeRuntimeEvents: () => () => undefined };
        try {
            const url = new URL(resolveWorkspacePreviewUrl('data/result.csv', 'session-123'));
            expect(url.protocol).toBe('data-agent:');
            expect(url.hostname).toBe('workspace');
            expect(url.pathname).toBe('/workspace/files/preview');
            expect(url.searchParams.get('path')).toBe('session-123/data/result.csv');
        } finally {
            delete window.dataAgentRuntime;
        }
    });
});
