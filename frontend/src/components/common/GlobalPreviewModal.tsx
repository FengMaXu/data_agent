import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ExternalLink, X } from '../icons/Typicons';
import { useLanguage } from '../../context/LanguageContext';
import { usePreview } from '../../context/PreviewContext';
import { resolveWorkspaceAssetUrl } from '../../utils/resolveInternalUrl';
import { getDashboardV3DataViaRuntime } from '../../api/runtime-client';

const SUPPORTED_MESSAGE_TYPES = new Set(['drill_down', 'navigate_back', 'dashboard_parameters_changed']);
const MARKDOWN_TYPES = new Set(['md', 'markdown']);
const CSV_TYPES = new Set(['csv']);
const TEXT_TYPES = new Set(['json', 'txt', 'log']);
const IMAGE_TYPES = new Set(['gif', 'jpeg', 'jpg', 'png', 'svg', 'webp']);
const BASE_IFRAME_WIDTH = 1440;
const MIN_MODAL_WIDTH = 520;
const MIN_MODAL_HEIGHT = 360;

interface PreviewRect {
    left: number;
    top: number;
    width: number;
    height: number;
}

interface DashboardParameterChangedMessage {
    type: 'dashboard_parameters_changed';
    requestId: string;
    parameters?: Record<string, unknown>;
    changed?: string[] | null;
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const initialPreviewRect = (): PreviewRect => {
    const width = clamp(Math.round(window.innerWidth * 0.78), MIN_MODAL_WIDTH, window.innerWidth - 32);
    const height = clamp(Math.round(window.innerHeight * 0.88), MIN_MODAL_HEIGHT, window.innerHeight - 32);
    return {
        left: Math.round((window.innerWidth - width) / 2),
        top: Math.round((window.innerHeight - height) / 2),
        width,
        height,
    };
};

function parseCsv(text: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let cell = '';
    let quoted = false;

    for (let index = 0; index < text.length; index += 1) {
        const character = text[index];
        const next = text[index + 1];
        if (character === '"' && quoted && next === '"') {
            cell += '"';
            index += 1;
        } else if (character === '"') {
            quoted = !quoted;
        } else if (character === ',' && !quoted) {
            row.push(cell);
            cell = '';
        } else if ((character === '\n' || character === '\r') && !quoted) {
            if (character === '\r' && next === '\n') index += 1;
            row.push(cell);
            if (row.some((item) => item.length > 0)) rows.push(row);
            row = [];
            cell = '';
        } else {
            cell += character;
        }
    }
    if (cell || row.length > 0) {
        row.push(cell);
        if (row.some((item) => item.length > 0)) rows.push(row);
    }
    return rows;
}

function rewriteHtmlAssets(html: string, sourceUrl: string): string {
    if (typeof DOMParser === 'undefined') return html;
    const document = new DOMParser().parseFromString(html, 'text/html');
    document.querySelectorAll<HTMLElement>('[src], [href]').forEach((element) => {
        for (const attribute of ['src', 'href']) {
            const value = element.getAttribute(attribute);
            if (!value || value.startsWith('#') || /^(data|blob|https?:|mailto|tel|javascript):/i.test(value)) continue;
            element.setAttribute(attribute, resolveWorkspaceAssetUrl(value, sourceUrl));
        }
    });
    document.querySelector('base')?.remove();

    const navigationGuard = document.createElement('script');
    navigationGuard.textContent = [
        'document.addEventListener("click", (event) => {',
        '    const link = event.target instanceof Element ? event.target.closest("a[href]") : null;',
        '    const href = link?.getAttribute("href") || "";',
        '    if (!href.startsWith("#")) return;',
        '    event.preventDefault();',
        '    event.stopPropagation();',
        '    document.getElementById(href.slice(1))?.scrollIntoView({ behavior: "smooth", block: "start" });',
        '});',
    ].join("\n");
    document.body.appendChild(navigationGuard);
    return `<!doctype html>${document.documentElement.outerHTML}`;
}
const GlobalPreviewModal: React.FC = () => {
    const { isOpen, url, title, fileType, closePreview, emitPreviewMessage } = usePreview();
    const { t } = useLanguage();
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const bodyRef = useRef<HTMLDivElement>(null);
    const dragRef = useRef<{ mode: 'move' | 'resize'; startX: number; startY: number; rect: PreviewRect } | null>(null);
    const dashboardRequestRef = useRef<AbortController | null>(null);
    const [rect, setRect] = useState<PreviewRect>(() => ({ left: 56, top: 42, width: 980, height: 720 }));
    const [bodySize, setBodySize] = useState({ width: 0, height: 0 });
    const [fileContent, setFileContent] = useState('');
    const [loading, setLoading] = useState(false);
    const [loadError, setLoadError] = useState('');

    const normalizedType = fileType.toLowerCase();
    const isHtml = normalizedType === 'html' || normalizedType === 'htm';
    const isMarkdown = MARKDOWN_TYPES.has(normalizedType);
    const isCsv = CSV_TYPES.has(normalizedType);
    const isText = TEXT_TYPES.has(normalizedType);
    const isImage = IMAGE_TYPES.has(normalizedType);
    const needsTextFetch = isHtml || isMarkdown || isCsv || isText;

    const handleDashboardParametersChanged = useCallback(async (message: DashboardParameterChangedMessage) => {
        const frame = iframeRef.current;
        if (!frame?.contentWindow || !url || !message.requestId) return;
        let dashboardPath = '';
        try {
            dashboardPath = new URL(url, window.location.href).searchParams.get('path') || '';
        } catch {
            dashboardPath = '';
        }
        if (!dashboardPath) {
            frame.contentWindow.postMessage({
                type: 'dashboard_data_error',
                requestId: message.requestId,
                message: '无法确定当前看板文件路径',
            }, '*');
            return;
        }
        dashboardRequestRef.current?.abort();
        const controller = new AbortController();
        dashboardRequestRef.current = controller;
        try {
            const payload = await getDashboardV3DataViaRuntime(dashboardPath);
            const charts = (payload as { charts?: Array<{ viewId?: string }> }).charts ?? [];
            const result = {
                requestId: message.requestId,
                parameters: message.parameters || {},
                data: {} as Record<string, { rows: unknown[] }>,
                errors: {} as Record<string, { code: string; message: string }>,
            };
            void charts;
            if (dashboardRequestRef.current !== controller || iframeRef.current?.contentWindow !== frame.contentWindow) return;
            frame.contentWindow.postMessage({ type: 'dashboard_data_patch', ...result }, '*');
        } catch (error: unknown) {
            if ((error instanceof DOMException && error.name === 'AbortError') || controller.signal.aborted) return;
            if (dashboardRequestRef.current !== controller || iframeRef.current?.contentWindow !== frame.contentWindow) return;
            frame.contentWindow.postMessage({
                type: 'dashboard_data_error',
                requestId: message.requestId,
                message: error instanceof Error ? error.message : '看板刷新失败',
            }, '*');
        }
    }, [url]);

    useEffect(() => {
        if (!isOpen) return;
        setRect(initialPreviewRect());
    }, [isOpen, url]);

    useEffect(() => {
        if (!isOpen || !url || !needsTextFetch) {
            setFileContent('');
            setLoadError('');
            setLoading(false);
            return undefined;
        }

        const controller = new AbortController();
        setLoading(true);
        setLoadError('');
        fetch(url, { signal: controller.signal })
            .then(async (response) => {
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                return response.text();
            })
            .then((text) => setFileContent(text))
            .catch((error: unknown) => {
                if (!(error instanceof DOMException && error.name === 'AbortError')) setLoadError(t('preview.loadError'));
            })
            .finally(() => setLoading(false));
        return () => controller.abort();
    }, [isOpen, needsTextFetch, t, url]);

    useEffect(() => {
        if (!isOpen || !url) return undefined;
        const handleMessage = (event: MessageEvent) => {
            if (event.source !== iframeRef.current?.contentWindow) return;
            const data = event.data;
            if (!data || typeof data !== 'object') return;
            if (data.type === 'dashboard_parameters_changed' && typeof data.requestId === 'string') {
                void handleDashboardParametersChanged({
                    type: 'dashboard_parameters_changed',
                    requestId: data.requestId,
                    parameters: data.parameters && typeof data.parameters === 'object' ? data.parameters as Record<string, unknown> : {},
                    changed: Array.isArray(data.changed) ? data.changed.filter((item: unknown): item is string => typeof item === 'string') : null,
                });
                return;
            }
            if (SUPPORTED_MESSAGE_TYPES.has(data.type)) {
                emitPreviewMessage(data);
            }
        };
        window.addEventListener('message', handleMessage);
        return () => {
            window.removeEventListener('message', handleMessage);
            dashboardRequestRef.current?.abort();
            dashboardRequestRef.current = null;
        };
    }, [emitPreviewMessage, handleDashboardParametersChanged, isOpen, url]);
    useEffect(() => {
        if (!isOpen) return undefined;
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') closePreview();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [closePreview, isOpen]);

    useEffect(() => {
        if (!isOpen || !bodyRef.current) return undefined;
        const observer = new ResizeObserver(([entry]) => {
            if (entry) setBodySize({ width: entry.contentRect.width, height: entry.contentRect.height });
        });
        observer.observe(bodyRef.current);
        return () => observer.disconnect();
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen) return undefined;
        const handleWindowResize = () => setRect((current) => {
            const width = Math.min(current.width, Math.max(MIN_MODAL_WIDTH, window.innerWidth - 16));
            const height = Math.min(current.height, Math.max(MIN_MODAL_HEIGHT, window.innerHeight - 16));
            return {
                width,
                height,
                left: clamp(current.left, 8, window.innerWidth - width - 8),
                top: clamp(current.top, 8, window.innerHeight - height - 8),
            };
        });
        window.addEventListener('resize', handleWindowResize);
        return () => window.removeEventListener('resize', handleWindowResize);
    }, [isOpen]);

    const handleOpenExternal = () => {
        if (url) window.open(url, '_blank', 'noopener,noreferrer');
    };

    const handlePointerMove = useCallback((event: PointerEvent) => {
        const dragState = dragRef.current;
        if (!dragState) return;
        const deltaX = event.clientX - dragState.startX;
        const deltaY = event.clientY - dragState.startY;
        if (dragState.mode === 'move') {
            setRect({
                ...dragState.rect,
                left: clamp(dragState.rect.left + deltaX, 8, window.innerWidth - dragState.rect.width - 8),
                top: clamp(dragState.rect.top + deltaY, 8, window.innerHeight - dragState.rect.height - 8),
            });
            return;
        }
        setRect({
            ...dragState.rect,
            width: clamp(dragState.rect.width + deltaX, MIN_MODAL_WIDTH, window.innerWidth - dragState.rect.left - 8),
            height: clamp(dragState.rect.height + deltaY, MIN_MODAL_HEIGHT, window.innerHeight - dragState.rect.top - 8),
        });
    }, []);

    const stopPointerInteraction = useCallback(() => {
        dragRef.current = null;
        document.body.classList.remove('global-preview-interacting');
        window.removeEventListener('pointermove', handlePointerMove);
    }, [handlePointerMove]);

    const startPointerInteraction = (mode: 'move' | 'resize', event: React.PointerEvent<HTMLElement>) => {
        if (event.button !== 0) return;
        event.preventDefault();
        dragRef.current = { mode, startX: event.clientX, startY: event.clientY, rect };
        document.body.classList.add('global-preview-interacting');
        window.addEventListener('pointermove', handlePointerMove);
        window.addEventListener('pointerup', stopPointerInteraction, { once: true });
        window.addEventListener('pointercancel', stopPointerInteraction, { once: true });
    };

    const handleResizeKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        setRect((current) => {
            const maxWidth = Math.max(MIN_MODAL_WIDTH, window.innerWidth - current.left - 8);
            const maxHeight = Math.max(MIN_MODAL_HEIGHT, window.innerHeight - current.top - 8);
            if (event.key === 'Home') {
                return { ...current, width: MIN_MODAL_WIDTH, height: MIN_MODAL_HEIGHT };
            }
            if (event.key === 'End') {
                return { ...current, width: maxWidth, height: maxHeight };
            }
            const step = event.shiftKey ? 100 : 40;
            const widthDelta = event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0;
            const heightDelta = event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0;
            return {
                ...current,
                width: clamp(current.width + widthDelta, MIN_MODAL_WIDTH, maxWidth),
                height: clamp(current.height + heightDelta, MIN_MODAL_HEIGHT, maxHeight),
            };
        });
    };

    const htmlContent = useMemo(() => (url ? rewriteHtmlAssets(fileContent, url) : ''), [fileContent, url]);
    const iframeScale = bodySize.width > 0 ? Math.min(1, bodySize.width / BASE_IFRAME_WIDTH) : 1;
    const iframeWidth = iframeScale < 1 ? BASE_IFRAME_WIDTH : Math.max(bodySize.width, BASE_IFRAME_WIDTH);
    const iframeHeight = bodySize.height > 0 ? bodySize.height / iframeScale : rect.height;

    const renderCsv = () => {
        const rows = parseCsv(fileContent);
        const headers = rows[0] || [];
        return (
            <div className="global-preview-table-wrap">
                <table className="global-preview-table">
                    <thead><tr>{headers.map((header, index) => <th key={index}>{header || t('preview.csvColumn').replace('{number}', String(index + 1))}</th>)}</tr></thead>
                    <tbody>{rows.slice(1, 201).map((row, rowIndex) => <tr key={rowIndex}>{headers.map((_, columnIndex) => <td key={columnIndex}>{row[columnIndex] || ''}</td>)}</tr>)}</tbody>
                </table>
                {rows.length > 201 && <div className="global-preview-limit">{t('preview.csvLimit')}</div>}
            </div>
        );
    };

    const renderMarkdown = () => (
        <article className="global-preview-markdown">
            <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                    img: ({ src, alt, ...props }) => <img src={resolveWorkspaceAssetUrl(src, url || undefined)} alt={alt || ''} loading="lazy" {...props} />,
                    a: ({ href, children, ...props }) => <a href={resolveWorkspaceAssetUrl(href, url || undefined)} target="_blank" rel="noopener noreferrer" {...props}>{children}</a>,
                }}
            >
                {fileContent}
            </ReactMarkdown>
        </article>
    );

    if (!isOpen || !url) return null;

    return (
        <div className="global-preview-overlay" role="dialog" aria-modal="false" aria-label={title || t('preview.title')}>
            <section className="global-preview-modal" style={{ width: rect.width, height: rect.height, left: rect.left, top: rect.top }}>
                <header className="global-preview-header" onPointerDown={(event) => startPointerInteraction('move', event)}>
                    <div className="global-preview-title-group">
                        <div className="global-preview-title">{title || t('preview.title')}</div>
                        <div className="global-preview-meta">{normalizedType || t('preview.file')}</div>
                    </div>
                    <div className="global-preview-actions" onPointerDown={(event) => event.stopPropagation()}>
                        <button type="button" className="global-preview-icon-btn" onClick={handleOpenExternal} aria-label={t('preview.openExternal')} title={t('preview.openExternal')}><ExternalLink size={18} strokeWidth={2} /></button>
                        <button type="button" className="global-preview-icon-btn" onClick={closePreview} aria-label={t('preview.close')} title={t('preview.close')}><X size={19} strokeWidth={2} /></button>
                    </div>
                </header>
                <div ref={bodyRef} className={`global-preview-body ${isImage ? 'is-image' : ''}`}>
                    {loading && <div className="global-preview-state" role="status">{t('preview.loading')}</div>}
                    {!loading && loadError && <div className="global-preview-state is-error" role="alert" aria-live="assertive">{loadError}</div>}
                    {!loading && !loadError && isImage && <img className="global-preview-image" src={url} alt={title || t('preview.file')} />}
                    {!loading && !loadError && isHtml && (
                        <div className="global-preview-scale-stage" style={{ width: iframeWidth, height: iframeHeight, transform: `scale(${iframeScale})` }}>
                            <iframe ref={iframeRef} srcDoc={htmlContent} title={title || t('preview.title')} className="global-preview-frame" sandbox="allow-scripts allow-downloads allow-forms allow-popups" style={{ width: iframeWidth, height: iframeHeight }} />
                        </div>
                    )}
                    {!loading && !loadError && isMarkdown && renderMarkdown()}
                    {!loading && !loadError && isCsv && renderCsv()}
                    {!loading && !loadError && isText && <pre className="global-preview-text">{fileContent}</pre>}
                    {!loading && !loadError && !isImage && !isHtml && !isMarkdown && !isCsv && !isText && <div className="global-preview-state" role="status">{t('preview.unsupported')}</div>}
                </div>
                <div
                    className="global-preview-resize-handle"
                    role="button"
                    tabIndex={0}
                    aria-label={t('preview.resize')}
                    title={t('preview.resize')}
                    aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown Home End"
                    onPointerDown={(event) => startPointerInteraction('resize', event)}
                    onKeyDown={handleResizeKeyDown}
                />
            </section>
        </div>
    );
};

export default GlobalPreviewModal;