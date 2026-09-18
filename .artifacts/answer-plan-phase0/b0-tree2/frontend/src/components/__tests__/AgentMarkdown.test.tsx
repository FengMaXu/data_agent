import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { createMarkdownComponents } from '../AgentMarkdown';

describe('AgentMarkdown workspace artifacts', () => {
    it('does not turn ordinary inline file references into artifact actions', () => {
        const components = createMarkdownComponents('session-123', vi.fn(), (key) => key);
        expect(components?.code).toBeUndefined();
    });

    it('adds preview and download actions only to an explicit workspace link', () => {
        const openPreview = vi.fn();
        const components = createMarkdownComponents('session-123', openPreview, (key) => key === 'widgets.preview' ? '查看' : '下载');
        const Anchor = components?.a as React.ComponentType<any>;
        const html = renderToStaticMarkup(<Anchor href="/workspace/files/download?path=session-123%2Fdata%2Fresult.csv">result.csv</Anchor>);

        expect(html).toContain('result.csv');
        expect(html).toContain('aria-label="查看"');
        expect(html).toContain('aria-label="下载"');
    });
});
