import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { createMarkdownComponents } from '../AgentMarkdown';

const labels = (key: string) => key === 'widgets.preview' ? '查看' : '下载';

describe('AgentMarkdown workspace artifacts', () => {
    it('does not turn ordinary inline file references into artifact actions', () => {
        const components = createMarkdownComponents('session-123', vi.fn(), labels);
        const Code = components?.code as React.ComponentType<any>;

        for (const reference of ['result.csv', 'business-rules.md', 'src/app.ts']) {
            const html = renderToStaticMarkup(<Code>{reference}</Code>);
            expect(html).toBe(`<code>${reference}</code>`);
        }
    });

    it('adds preview and download actions to an inline path under a session output folder', () => {
        const components = createMarkdownComponents('session-123', vi.fn(), labels);
        const Code = components?.code as React.ComponentType<any>;
        const html = renderToStaticMarkup(<Code>dashboards/industry_sales_dashboard.html</Code>);

        expect(html).toContain('<code>dashboards/industry_sales_dashboard.html</code>');
        expect(html).toContain('aria-label="查看"');
        expect(html).toContain('aria-label="下载"');
    });

    it('leaves fenced code blocks alone', () => {
        const components = createMarkdownComponents('session-123', vi.fn(), labels);
        const Code = components?.code as React.ComponentType<any>;
        const html = renderToStaticMarkup(<Code className="language-text">dashboards/x.html</Code>);

        expect(html).not.toContain('aria-label="查看"');
    });

    it('adds preview and download actions only to an explicit workspace link', () => {
        const components = createMarkdownComponents('session-123', vi.fn(), labels);
        const Anchor = components?.a as React.ComponentType<any>;
        const html = renderToStaticMarkup(<Anchor href="/workspace/files/download?path=session-123%2Fdata%2Fresult.csv">result.csv</Anchor>);

        expect(html).toContain('result.csv');
        expect(html).toContain('aria-label="查看"');
        expect(html).toContain('aria-label="下载"');
    });

    it('treats a publication link as a previewable CSV', () => {
        const openPreview = vi.fn();
        const components = createMarkdownComponents('session-123', openPreview, labels);
        const Anchor = components?.a as React.ComponentType<any>;
        const html = renderToStaticMarkup(
            <Anchor href="/api/runtime/publications/publication_158d0f52?session_id=session-123">下载</Anchor>,
        );

        expect(html).toContain('aria-label="查看"');
        expect(html).toContain('download="publication_158d0f52.csv"');
    });
});
