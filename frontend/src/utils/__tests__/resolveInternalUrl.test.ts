import { describe, expect, it } from 'vitest';
import {
    isWorkspaceRelativePath,
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
        expect(url.pathname).toBe('/workspace/files/download');
        expect(url.searchParams.get('path')).toBe('session-123/data/industry_sales_2026_h1.csv');
    });

    it('converts a relative asset to the authenticated preview endpoint', () => {
        const url = new URL(resolveWorkspacePreviewUrl('data/industry_sales_2026_h1.csv', 'session-123'));
        expect(url.pathname).toBe('/workspace/files/preview');
        expect(url.searchParams.get('path')).toBe('session-123/data/industry_sales_2026_h1.csv');
    });
});
