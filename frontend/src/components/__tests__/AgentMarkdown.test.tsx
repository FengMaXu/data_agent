import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { createMarkdownComponents } from '../AgentMarkdown';

describe('AgentMarkdown workspace artifacts', () => {
    it('adds preview and download actions to an inline result-file path', () => {
        const openPreview = vi.fn();
        const components = createMarkdownComponents('session-123', openPreview, (key) => key === 'widgets.preview' ? '查看' : '下载');
        const Code = components?.code as React.ComponentType<any>;
        const html = renderToStaticMarkup(<Code>{'dashboards/result.html'}</Code>);

        expect(html).toContain('dashboards/result.html');
        expect(html).toContain('aria-label="查看"');
        expect(html).toContain('aria-label="下载"');
    });

    it('keeps non-file inline code as plain code', () => {
        const components = createMarkdownComponents('session-123', vi.fn(), (key) => key);
        const Code = components?.code as React.ComponentType<any>;
        const html = renderToStaticMarkup(<Code>{'sales_ytd'}</Code>);

        expect(html).toBe('<code>sales_ytd</code>');
    });
});
