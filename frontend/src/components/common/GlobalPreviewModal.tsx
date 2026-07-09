import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ExternalLink, X } from '../icons/Typicons';
import { useLanguage } from '../../context/LanguageContext';
import { usePreview } from '../../context/PreviewContext';

const SUPPORTED_MESSAGE_TYPES = new Set(['drill_down', 'navigate_back']);
const BASE_IFRAME_WIDTH = 1440;
const MIN_MODAL_WIDTH = 520;
const MIN_MODAL_HEIGHT = 360;

interface PreviewRect {
    left: number;
    top: number;
    width: number;
    height: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const initialPreviewRect = (): PreviewRect => {
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const width = clamp(Math.round(viewportWidth * 0.66), MIN_MODAL_WIDTH, viewportWidth - 48);
    const height = clamp(Math.round(viewportHeight * 0.88), MIN_MODAL_HEIGHT, viewportHeight - 48);
    return {
        left: Math.round((viewportWidth - width) / 2),
        top: Math.round((viewportHeight - height) / 2),
        width,
        height,
    };
};

const GlobalPreviewModal: React.FC = () => {
    const { isOpen, url, title, fileType, closePreview, emitPreviewMessage } = usePreview();
    const { t } = useLanguage();
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const bodyRef = useRef<HTMLDivElement>(null);
    const dragRef = useRef<{
        mode: 'move' | 'resize';
        startX: number;
        startY: number;
        rect: PreviewRect;
    } | null>(null);
    const [rect, setRect] = useState<PreviewRect>(() => (
        typeof window === 'undefined'
            ? { left: 56, top: 42, width: 980, height: 720 }
            : initialPreviewRect()
    ));
    const [bodySize, setBodySize] = useState({ width: 0, height: 0 });

    useEffect(() => {
        if (!isOpen) return;
        setRect(initialPreviewRect());
    }, [isOpen, url]);

    useEffect(() => {
        if (!isOpen || !url) return undefined;

        const handleMessage = (event: MessageEvent) => {
            if (event.source !== iframeRef.current?.contentWindow) {
                return;
            }

            const data = event.data;
            if (!data || typeof data !== 'object' || !SUPPORTED_MESSAGE_TYPES.has(data.type)) {
                return;
            }

            emitPreviewMessage(data);
        };

        window.addEventListener('message', handleMessage);
        return () => window.removeEventListener('message', handleMessage);
    }, [emitPreviewMessage, isOpen, url]);

    useEffect(() => {
        if (!isOpen) return undefined;

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                closePreview();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [closePreview, isOpen]);

    useEffect(() => {
        if (!isOpen || !bodyRef.current) return undefined;

        const resizeObserver = new ResizeObserver(([entry]) => {
            if (!entry) return;
            const { width, height } = entry.contentRect;
            setBodySize({ width, height });
        });

        resizeObserver.observe(bodyRef.current);
        return () => resizeObserver.disconnect();
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen) return undefined;

        const handleWindowResize = () => {
            setRect((current) => {
                const maxWidth = Math.max(MIN_MODAL_WIDTH, window.innerWidth - 16);
                const maxHeight = Math.max(MIN_MODAL_HEIGHT, window.innerHeight - 16);
                const width = Math.min(current.width, maxWidth);
                const height = Math.min(current.height, maxHeight);
                return {
                    width,
                    height,
                    left: clamp(current.left, 8, window.innerWidth - width - 8),
                    top: clamp(current.top, 8, window.innerHeight - height - 8),
                };
            });
        };

        window.addEventListener('resize', handleWindowResize);
        return () => window.removeEventListener('resize', handleWindowResize);
    }, [isOpen]);

    const normalizedType = fileType.toLowerCase();
    const isHtml = normalizedType === 'html' || normalizedType === 'htm';

    const handleOpenExternal = () => {
        if (!url) return;
        window.open(url, '_blank', 'noopener,noreferrer');
    };

    const handlePointerMove = useCallback((event: PointerEvent) => {
        const dragState = dragRef.current;
        if (!dragState) return;

        const deltaX = event.clientX - dragState.startX;
        const deltaY = event.clientY - dragState.startY;
        const sourceRect = dragState.rect;

        if (dragState.mode === 'move') {
            setRect({
                ...sourceRect,
                left: clamp(sourceRect.left + deltaX, 8, window.innerWidth - sourceRect.width - 8),
                top: clamp(sourceRect.top + deltaY, 8, window.innerHeight - sourceRect.height - 8),
            });
            return;
        }

        const width = clamp(sourceRect.width + deltaX, MIN_MODAL_WIDTH, window.innerWidth - sourceRect.left - 8);
        const height = clamp(sourceRect.height + deltaY, MIN_MODAL_HEIGHT, window.innerHeight - sourceRect.top - 8);
        setRect({
            ...sourceRect,
            width,
            height,
        });
    }, []);

    const stopPointerInteraction = useCallback(() => {
        dragRef.current = null;
        document.body.classList.remove('global-preview-interacting');
        window.removeEventListener('pointermove', handlePointerMove);
        window.removeEventListener('pointerup', stopPointerInteraction);
        window.removeEventListener('pointercancel', stopPointerInteraction);
    }, [handlePointerMove]);

    const startPointerInteraction = (
        mode: 'move' | 'resize',
        event: React.PointerEvent<HTMLElement>,
    ) => {
        if (event.button !== 0) return;
        event.preventDefault();
        dragRef.current = {
            mode,
            startX: event.clientX,
            startY: event.clientY,
            rect,
        };
        document.body.classList.add('global-preview-interacting');
        window.addEventListener('pointermove', handlePointerMove);
        window.addEventListener('pointerup', stopPointerInteraction);
        window.addEventListener('pointercancel', stopPointerInteraction);
    };

    const iframeScale = bodySize.width > 0
        ? Math.min(1, bodySize.width / BASE_IFRAME_WIDTH)
        : 1;
    const iframeWidth = iframeScale < 1 ? BASE_IFRAME_WIDTH : Math.max(bodySize.width, BASE_IFRAME_WIDTH);
    const iframeHeight = bodySize.height > 0 ? bodySize.height / iframeScale : rect.height;

    if (!isOpen || !url) {
        return null;
    }

    return (
        <div
            className="global-preview-overlay"
            role="dialog"
            aria-modal="false"
            aria-label={title || t('preview.title')}
        >
            <section
                className="global-preview-modal"
                style={{
                    width: rect.width,
                    height: rect.height,
                    left: rect.left,
                    top: rect.top,
                }}
            >
                <header
                    className="global-preview-header"
                    onPointerDown={(event) => startPointerInteraction('move', event)}
                >
                    <div className="global-preview-title-group">
                        <div className="global-preview-title">{title || t('preview.title')}</div>
                        <div className="global-preview-meta">{normalizedType || t('preview.file')}</div>
                    </div>
                    <div
                        className="global-preview-actions"
                        onPointerDown={(event) => event.stopPropagation()}
                    >
                        <button
                            type="button"
                            className="global-preview-icon-btn"
                            onClick={handleOpenExternal}
                            aria-label={t('preview.openExternal')}
                            title={t('preview.openExternal')}
                        >
                            <ExternalLink size={18} strokeWidth={2} />
                        </button>
                        <button
                            type="button"
                            className="global-preview-icon-btn"
                            onClick={closePreview}
                            aria-label={t('preview.close')}
                            title={t('preview.close')}
                        >
                            <X size={19} strokeWidth={2} />
                        </button>
                    </div>
                </header>
                <div ref={bodyRef} className="global-preview-body">
                    {isHtml ? (
                        <div
                            className="global-preview-scale-stage"
                            style={{
                                width: iframeWidth,
                                height: iframeHeight,
                                transform: `scale(${iframeScale})`,
                            }}
                        >
                            <iframe
                                ref={iframeRef}
                                src={url}
                                title={title || t('preview.title')}
                                className="global-preview-frame"
                                sandbox="allow-scripts allow-same-origin allow-downloads allow-forms allow-popups"
                                style={{
                                    width: iframeWidth,
                                    height: iframeHeight,
                                }}
                            />
                        </div>
                    ) : (
                        <div className="global-preview-unsupported">
                            {t('preview.unsupported')}
                        </div>
                    )}
                </div>
                <div
                    className="global-preview-resize-handle"
                    role="separator"
                    aria-orientation="vertical"
                    aria-label="调整预览窗口大小"
                    onPointerDown={(event) => startPointerInteraction('resize', event)}
                />
            </section>
        </div>
    );
};

export default GlobalPreviewModal;