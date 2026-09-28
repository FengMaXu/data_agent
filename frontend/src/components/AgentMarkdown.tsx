/**
 * Shared Markdown renderer for chat output and file previews.
 *
 * Workspace links keep their download behavior, while previewable files expose
 * an inline preview action. Relative workspace assets are resolved against the
 * active session so generated report images render as compact preview triggers in chat.
 */

import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Download, Eye } from './icons/Typicons';
import { useLanguage } from '../context/LanguageContext';
import { usePreview } from '../context/PreviewContext';
import {
    isInternalApiPath,
    isWorkspaceRelativePath,
    resolveWorkspaceAssetUrl,
    resolveWorkspaceDownloadUrl,
    resolveWorkspacePreviewUrl,
} from '../utils/resolveInternalUrl';

const PREVIEWABLE_FILE_TYPES = new Set([
    'csv', 'gif', 'htm', 'html', 'jpeg', 'jpg', 'json', 'md', 'markdown', 'png', 'svg', 'txt', 'webp',
]);

const PUBLICATION_PATH = /\/api\/runtime\/publications\/([^/?#]+)/;

/** Publications are always served as CSV, but their URL carries no extension. */
function getPublicationFileName(href: string | undefined): string {
    const match = href?.match(PUBLICATION_PATH);
    return match ? `${decodeURIComponent(match[1])}.csv` : '';
}

function getWorkspaceDownloadPath(href: string | undefined): string {
    if (!href) return '';
    try {
        const url = new URL(href, 'http://data-agent.local');
        if (!url.pathname.endsWith('/workspace/files/download')) return '';
        return url.searchParams.get('path') || '';
    } catch {
        return '';
    }
}

function getFileTypeFromPath(path: string): string {
    const fileName = path.split(/[\\/]/).pop() || '';
    return (fileName.split('.').pop() || '').toLowerCase();
}

function getFileTitle(path: string, fallback: React.ReactNode): string {
    const fileName = path.split(/[\\/]/).pop();
    if (fileName) return fileName;
    return typeof fallback === 'string' ? fallback : 'preview';
}

function getImagePreviewTitle(src: string | undefined, alt: string | undefined): string {
    if (alt?.trim()) return alt.trim();
    const sourceName = src?.split(/[\\/?#]/).pop() || '';
    return sourceName || 'image';
}

function getImagePreviewType(src: string | undefined): string {
    const sourceName = src?.split(/[\\/?#]/).pop() || '';
    return sourceName.split('.').pop()?.toLowerCase() || 'png';
}

function renderFileActions(
    href: string,
    children: React.ReactNode,
    currentSessionId: string | undefined,
    openPreview: ((url: string, title: string, fileType: string) => void) | undefined,
    t: ((key: string) => string) | undefined,
    linkProps: React.AnchorHTMLAttributes<HTMLAnchorElement> = {},
): React.ReactElement {
    const resolved = resolveWorkspaceDownloadUrl(href, currentSessionId);
    const previewUrl = resolveWorkspacePreviewUrl(href, currentSessionId);
    const filePath = getPublicationFileName(href) || getWorkspaceDownloadPath(resolved) || href;
    const fileType = getFileTypeFromPath(filePath);
    const canPreview = PREVIEWABLE_FILE_TYPES.has(fileType);
    const title = getFileTitle(filePath, children);
    const previewLabel = t?.('widgets.preview') || '查看';
    const downloadLabel = t?.('widgets.download') || '下载';
    const triggerDownload = (event: React.MouseEvent<HTMLElement>) => {
        event.preventDefault();
        const link = document.createElement('a');
        link.href = resolved;
        link.download = title;
        document.body.appendChild(link);
        link.click();
        link.remove();
    };

    return (
        <span className="agent-file-action-row">
            <a
                href={resolved}
                download={title}
                className="agent-file-label agent-file-label-link"
                {...linkProps}
            >
                {children}
            </a>
            <span className="agent-file-actions">
                {canPreview && openPreview && previewUrl && (
                    <button
                        type="button"
                        className="agent-file-action-btn"
                        onClick={(event) => {
                            event.preventDefault();
                            openPreview(previewUrl, title, fileType);
                        }}
                        title={previewLabel}
                        aria-label={previewLabel}
                    >
                        <Eye size={15} strokeWidth={2} />
                    </button>
                )}
                <button
                    type="button"
                    className="agent-file-action-btn"
                    onClick={triggerDownload}
                    title={downloadLabel}
                    aria-label={downloadLabel}
                >
                    <Download size={15} strokeWidth={2} />
                </button>
            </span>
        </span>
    );
}

export const createMarkdownComponents = (
    currentSessionId?: string,
    openPreview?: (url: string, title: string, fileType: string) => void,
    t?: (key: string) => string,
): React.ComponentProps<typeof ReactMarkdown>['components'] => ({
    img: ({ src, alt, ...props }) => {
        const resolvedSrc = resolveWorkspaceAssetUrl(src, undefined, currentSessionId);
        const title = getImagePreviewTitle(src, alt);
        const fileType = getImagePreviewType(src);
        const image = <img src={resolvedSrc} alt={alt || title} loading="lazy" {...props} />;

        if (!openPreview || !resolvedSrc) {
            return <span className="agent-inline-image-frame">{image}</span>;
        }

        return (
            <button
                type="button"
                className="agent-inline-image-trigger"
                onClick={(event) => {
                    event.stopPropagation();
                    openPreview(resolvedSrc, title, fileType);
                }}
                aria-label={title}
                title={title}
            >
                {image}
                <span className="agent-inline-image-action" aria-hidden="true">
                    <Eye size={16} strokeWidth={2} />
                </span>
            </button>
        );
    },
    a: ({ href, children, ...props }) => {
        const isWorkspaceLink = isInternalApiPath(href) || isWorkspaceRelativePath(href);
        if (!isWorkspaceLink) {
            return (
                <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
                    {children}
                </a>
            );
        }

        return renderFileActions(href, children, currentSessionId, openPreview, t, props);
    },
    code: ({ className, children, node: _node, ...props }) => {
        // Agents often name a produced file as inline code (`dashboards/x.html`) rather than a link;
        // give those the same preview and download actions.
        const text = typeof children === 'string' ? children.trim() : '';
        const isInlinePath = !className && text && !text.includes('\n') && isWorkspaceRelativePath(text);
        if (isInlinePath && PREVIEWABLE_FILE_TYPES.has(getFileTypeFromPath(text))) {
            return renderFileActions(text, <code>{text}</code>, currentSessionId, openPreview, t);
        }
        return <code className={className} {...props}>{children}</code>;
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