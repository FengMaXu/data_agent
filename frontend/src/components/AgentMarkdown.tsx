/**
 * AgentMarkdown is the single entry point for rendering Markdown produced by
 * the agent (chat replies, tool outputs, knowledge previews, etc.).
 *
 * Key responsibilities beyond plain ReactMarkdown:
 *  1. GFM support (tables, strikethrough, and related Markdown extensions).
 *  2. Internal-link resolution: `/workspace/...` hrefs become absolute backend
 *     URLs with auth tokens, so clicks download files instead of navigating away.
 *  3. Sane external-link defaults: target="_blank" + noopener.
 */

import React from 'react';
import { Eye } from './icons/Typicons';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useLanguage } from '../context/LanguageContext';
import { usePreview } from '../context/PreviewContext';
import {
    isInternalApiPath,
    resolveInternalUrl,
    resolveWorkspacePreviewUrl,
} from '../utils/resolveInternalUrl';

const PREVIEWABLE_FILE_TYPES = new Set(['html', 'htm']);

function getWorkspaceDownloadPath(href: string | undefined): string {
    if (!href || !href.startsWith('/workspace/files/download')) {
        return '';
    }

    try {
        const url = new URL(href, 'http://data-agent.local');
        return url.searchParams.get('path') || '';
    } catch {
        return '';
    }
}

function getFileTypeFromPath(path: string): string {
    const fileName = path.split(/[\\/]/).pop() || '';
    const extension = fileName.split('.').pop() || '';
    return extension.toLowerCase();
}

function getFileTitle(path: string, fallback: React.ReactNode): string {
    const fileName = path.split(/[\\/]/).pop();
    if (fileName) {
        return fileName;
    }
    if (typeof fallback === 'string') {
        return fallback;
    }
    return 'preview';
}

const createMarkdownComponents = (
    currentSessionId?: string,
    openPreview?: (url: string, title: string, fileType: string) => void,
    t?: (key: string) => string,
): React.ComponentProps<typeof ReactMarkdown>['components'] => ({
    a: ({ href, children, ...props }) => {
        if (isInternalApiPath(href)) {
            const resolved = resolveInternalUrl(href, currentSessionId);
            const previewUrl = resolveWorkspacePreviewUrl(href, currentSessionId);
            const workspacePath = getWorkspaceDownloadPath(href);
            const fileType = getFileTypeFromPath(workspacePath);
            const canPreview = PREVIEWABLE_FILE_TYPES.has(fileType);
            const title = getFileTitle(workspacePath, children);
            const downloadLink = (
                <a
                    href={resolved}
                    onClick={(e) => {
                        e.preventDefault();
                        const link = document.createElement('a');
                        link.href = resolved;
                        link.download = title;
                        document.body.appendChild(link);
                        link.click();
                        link.remove();
                    }}
                    {...props}
                >
                    {children}
                </a>
            );

            if (!canPreview || !openPreview) {
                return downloadLink;
            }

            return (
                <span className="agent-file-link-enhanced">
                    {downloadLink}
                    <button
                        type="button"
                        className="agent-file-preview-btn"
                        onClick={() => openPreview(previewUrl, title, fileType)}
                    >
                        <Eye size={15} strokeWidth={2} />
                        <span>{t?.('widgets.preview') || '查看'}</span>
                    </button>
                </span>
            );
        }

        // External links open in a new tab
        return (
            <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
                {children}
            </a>
        );
    },
});

interface AgentMarkdownProps {
    children: string;
    currentSessionId?: string;
}

const AgentMarkdown: React.FC<AgentMarkdownProps> = ({ children, currentSessionId }) => {
    const { openPreview } = usePreview();
    const { t } = useLanguage();
    const components = React.useMemo(
        () => createMarkdownComponents(currentSessionId, openPreview, t),
        [currentSessionId, openPreview, t],
    );

    return (
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
            {children}
        </ReactMarkdown>
    );
};

export default AgentMarkdown;