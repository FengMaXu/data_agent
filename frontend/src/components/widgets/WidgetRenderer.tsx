import React, { useEffect, useRef } from 'react';
import * as echarts from 'echarts';
import { useLanguage } from '../../context/LanguageContext';
import { usePreview } from '../../context/PreviewContext';
import { resolveInternalUrl, resolveWorkspacePreviewUrl } from '../../utils/resolveInternalUrl';
import { Download, Eye, File, FileCode, FileSpreadsheet, FileText, Image } from '../icons/Typicons';

export type WidgetKind = 'kpi' | 'metric_cards' | 'table' | 'chart' | 'steps' | 'rich_text' | 'echarts' | 'file_link';

const PREVIEWABLE_FILE_TYPES = new Set(['csv', 'gif', 'htm', 'html', 'jpeg', 'jpg', 'json', 'md', 'markdown', 'png', 'svg', 'txt', 'webp']);

export interface WidgetSpec {
    widget_id: string;
    kind: WidgetKind;
    title: string;
    subtitle?: string;
    data?: any[];
    value?: string | number;
    label?: string;
    series?: any[];
    columns?: any[];
    actions?: any[];
    metadata?: Record<string, any>;
    raw_html?: string;
    raw_svg?: string;
    config?: Record<string, any>;
    file_path?: string;
    download_url?: string;
    file_type?: string;
    status?: 'previewing' | 'ready' | 'error';
    error?: string;
}

interface WidgetRendererProps {
    widget: WidgetSpec;
    drillPath?: string[];
    onDrillDown?: (dimension: string, value: string, widgetTitle: string, widgetId: string) => void;
    onBreadcrumbNavigate?: (widgetId: string, index: number) => void;
    currentSessionId?: string;
}

const cardStyle: React.CSSProperties = {
    border: '1px solid #e5e7eb',
    borderRadius: '12px',
    background: '#ffffff',
    padding: '12px',
};

const sectionTitleStyle: React.CSSProperties = {
    fontSize: '15px',
    fontWeight: 600,
    color: '#111827',
};

const sectionSubtitleStyle: React.CSSProperties = {
    fontSize: '12px',
    color: '#6b7280',
    marginTop: '4px',
};

const getColumnKey = (column: any, index: number) => (
    column?.key ?? column?.field ?? column?.accessor ?? column?.id ?? `column_${index}`
);

const getColumnLabel = (column: any, key: string) => (
    column?.label ?? column?.headerName ?? column?.title ?? key
);

const normalizeColumns = (widget: WidgetSpec, rows: any[]) => {
    if (Array.isArray(widget.columns) && widget.columns.length > 0) {
        return widget.columns.map((column: any, index: number) => {
            const key = getColumnKey(column, index);
            const label = getColumnLabel(column, key);
            return { ...column, key, label };
        });
    }

    return rows[0] ? Object.keys(rows[0]).map((key) => ({ key, label: key })) : [];
};

const parseFiniteNumber = (value: unknown): number | null => {
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : null;
    }
    if (typeof value === 'string') {
        const normalized = value.replace(/,/g, '').trim();
        if (!normalized) {
            return null;
        }
        const parsed = Number(normalized);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
};

const pickNumber = (...values: unknown[]) => {
    for (const value of values) {
        if (typeof value === 'number' && Number.isFinite(value)) {
            return value;
        }
    }
    return undefined;
};

const pickBoolean = (...values: unknown[]) => {
    for (const value of values) {
        if (typeof value === 'boolean') {
            return value;
        }
    }
    return undefined;
};

const pickString = (...values: unknown[]) => {
    for (const value of values) {
        if (typeof value === 'string' && value.trim()) {
            return value.trim();
        }
    }
    return undefined;
};

const inferColumnFormat = (column: any, numericValue: number) => {
    const formatter = column?.valueFormatter;
    const formatterConfig = formatter && typeof formatter === 'object' ? formatter : {};
    const typeParts = [
        column?.type,
        column?.dataType,
        typeof formatter === 'string' ? formatter : undefined,
        formatterConfig?.type,
        formatterConfig?.name,
        formatterConfig?.kind,
        column?.label,
        column?.headerName,
        column?.title,
        column?.field,
        column?.key,
    ].flat().filter(Boolean).map(String);
    const semanticText = typeParts.join(' ').toLowerCase();

    const precision = pickNumber(
        column?.precision,
        column?.decimals,
        column?.fractionDigits,
        column?.minimumFractionDigits,
        column?.maximumFractionDigits,
        formatterConfig?.precision,
        formatterConfig?.decimals,
        formatterConfig?.fractionDigits,
        formatterConfig?.minimumFractionDigits,
        formatterConfig?.maximumFractionDigits,
        (() => {
            const matched = typeof formatter === 'string' ? formatter.match(/(\d+)/) : null;
            return matched ? Number(matched[1]) : undefined;
        })(),
    );

    const useGrouping = pickBoolean(
        column?.useGrouping,
        column?.thousandSeparator,
        column?.thousandsSeparator,
        formatterConfig?.useGrouping,
        formatterConfig?.thousandSeparator,
        formatterConfig?.thousandsSeparator,
    );

    const prefix = pickString(column?.prefix, formatterConfig?.prefix);
    const suffix = pickString(column?.suffix, formatterConfig?.suffix);
    const explicitPercentScale = pickString(column?.percentScale, formatterConfig?.percentScale);

    const isPercent = /(percent|percentage|百分比|占比|同比|环比|增速|rate)/.test(semanticText);
    const isInteger = /(integer|int|count|数量|户数|家数|数量级)/.test(semanticText);
    const isAmount = /(amount|currency|sales|金额|销售额|产值|亿元|万元|元)/.test(semanticText);

    let normalizedValue = numericValue;
    if (isPercent) {
        const shouldScaleFromRatio = explicitPercentScale
            ? explicitPercentScale.toLowerCase() === 'ratio'
            : Math.abs(numericValue) > 0 && Math.abs(numericValue) <= 1;
        if (shouldScaleFromRatio) {
            normalizedValue = numericValue * 100;
        }
    }

    return {
        normalizedValue,
        minimumFractionDigits: precision ?? (isPercent || isAmount ? 2 : isInteger ? 0 : 0),
        maximumFractionDigits: precision ?? (isPercent || isAmount ? 2 : isInteger ? 0 : Number.isInteger(normalizedValue) ? 0 : 4),
        useGrouping: useGrouping ?? true,
        prefix,
        suffix: suffix ?? (isPercent ? '%' : undefined),
    };
};

const formatTableCell = (value: unknown, column: any, t: (key: string) => string) => {
    if (value === null || value === undefined) {
        return '';
    }

    if (typeof value === 'boolean') {
        return value ? t('widgets.true') : t('widgets.false');
    }

    const numericValue = parseFiniteNumber(value);
    if (numericValue !== null) {
        const format = inferColumnFormat(column, numericValue);
        const formatted = new Intl.NumberFormat('zh-CN', {
            useGrouping: format.useGrouping,
            minimumFractionDigits: format.minimumFractionDigits,
            maximumFractionDigits: format.maximumFractionDigits,
        }).format(format.normalizedValue);
        return `${format.prefix ?? ''}${formatted}${format.suffix ?? ''}`;
    }

    if (Array.isArray(value) || typeof value === 'object') {
        return JSON.stringify(value);
    }

    return String(value);
};

const renderMetricCards = (widget: WidgetSpec, t: (key: string) => string) => {
    const items = Array.isArray(widget.data)
        ? widget.data
        : widget.value !== undefined
            ? [{ label: widget.label, value: widget.value }]
            : [];
    return (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '10px' }}>
            {items.map((item, index) => (
                <div key={index} style={{ ...cardStyle, background: '#f9fafb' }}>
                    <div style={{ fontSize: '12px', color: '#6b7280' }}>{item.label ?? item.name ?? `${t('widgets.metric')} ${index + 1}`}</div>
                    <div style={{ fontSize: '24px', fontWeight: 700, color: '#111827', marginTop: '6px' }}>{item.value ?? '--'}</div>
                    {(item.change ?? item.description) && (
                        <div style={{ fontSize: '12px', color: '#4b5563', marginTop: '6px' }}>{item.change ?? item.description}</div>
                    )}
                </div>
            ))}
        </div>
    );
};

const renderTable = (widget: WidgetSpec, t: (key: string) => string) => {
    const rows = Array.isArray(widget.data) ? widget.data : [];
    const columns = normalizeColumns(widget, rows);

    return (
        <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                <thead>
                    <tr>
                        {columns.map((column: any, index: number) => (
                            <th key={index} style={{ textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid #e5e7eb', color: '#6b7280', fontWeight: 600 }}>
                                {column.label ?? column.key ?? `${t('widgets.column')} ${index + 1}`}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {rows.map((row, rowIndex) => (
                        <tr key={rowIndex}>
                            {columns.map((column: any, colIndex: number) => (
                                <td key={colIndex} style={{ padding: '8px 10px', borderBottom: '1px solid #f3f4f6', color: '#111827' }}>
                                    {formatTableCell(row[column.key], column, t)}
                                </td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
};


const renderChart = (widget: WidgetSpec, t: (key: string) => string) => {
    const points = Array.isArray(widget.data) ? widget.data : [];
    const values = points
        .map((point) => Number(point.value ?? point.y ?? 0))
        .filter((value) => Number.isFinite(value));
    const maxValue = values.length > 0 ? Math.max(...values, 1) : 1;

    return (
        <div style={{ display: 'grid', gap: '10px' }}>
            {points.map((point, index) => {
                const value = Number(point.value ?? point.y ?? 0);
                const width = `${Math.max(8, (value / maxValue) * 100)}%`;
                return (
                    <div key={index} style={{ display: 'grid', gap: '4px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#4b5563' }}>
                            <span>{point.label ?? point.x ?? `${t('widgets.dataPoint')} ${index + 1}`}</span>
                            <span>{Number.isFinite(value) ? value : point.value ?? point.y ?? '--'}</span>
                        </div>
                        <div style={{ height: '10px', background: '#f3f4f6', borderRadius: '999px', overflow: 'hidden' }}>
                            <div style={{ width, height: '100%', background: '#2563eb', borderRadius: '999px' }} />
                        </div>
                    </div>
                );
            })}
        </div>
    );
};

const renderSteps = (widget: WidgetSpec, t: (key: string) => string) => {
    const steps = Array.isArray(widget.data) ? widget.data : [];
    return (
        <ol style={{ margin: 0, paddingLeft: '20px', display: 'grid', gap: '10px' }}>
            {steps.map((step, index) => (
                <li key={index} style={{ color: '#111827' }}>
                    <div style={{ fontWeight: 600 }}>{step.title ?? step.label ?? `${t('widgets.step')} ${index + 1}`}</div>
                    {(step.description ?? step.content) && (
                        <div style={{ fontSize: '13px', color: '#4b5563', marginTop: '4px' }}>{step.description ?? step.content}</div>
                    )}
                </li>
            ))}
        </ol>
    );
};

const renderRichTextBlock = (block: any, t: (key: string) => string) => {
    if (typeof block === 'string') return block;
    if (!block || typeof block !== 'object') return String(block ?? '');
    if (block.type === 'notice') {
        return <div style={{ color: '#64748b', fontSize: '12px' }}>{block.text || t('widgets.preview')}</div>;
    }
    if (block.type === 'table' && Array.isArray(block.headers) && Array.isArray(block.rows)) {
        const rows = block.rows.slice(0, 12).map((row: any) => (Array.isArray(row) ? row : Object.values(row || {})));
        return (
            <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                    <thead><tr>{block.headers.map((header: any, index: number) => <th key={index} style={{ textAlign: 'left', padding: '7px 9px', borderBottom: '1px solid #e5e7eb', color: '#6b7280' }}>{String(header)}</th>)}</tr></thead>
                    <tbody>{rows.map((row: any[], rowIndex: number) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex} style={{ padding: '7px 9px', borderBottom: '1px solid #f3f4f6' }}>{String(cell ?? '')}</td>)}</tr>)}</tbody>
                </table>
            </div>
        );
    }
    if ((block.type === 'ol' || block.type === 'ul' || block.type === 'list') && Array.isArray(block.items)) {
        const List = block.type === 'ul' || block.type === 'list' ? 'ul' : 'ol';
        return <List style={{ margin: 0, paddingLeft: '20px' }}>{block.items.slice(0, 10).map((item: any, index: number) => <li key={index}>{String(item)}</li>)}</List>;
    }
    return block.text ?? block.content ?? JSON.stringify(block);
};

const renderRichText = (widget: WidgetSpec, t: (key: string) => string) => {
    const blocks = Array.isArray(widget.data) ? widget.data : [];
    const visibleBlocks: any[] = [];
    let charCount = 0;
    for (const block of blocks) {
        const size = typeof block === 'string' ? block.length : JSON.stringify(block).length;
        if (visibleBlocks.length >= 7 || charCount + size > 2600) break;
        visibleBlocks.push(block);
        charCount += size;
    }
    const truncated = visibleBlocks.length < blocks.length;
    return (
        <div style={{ display: 'grid', gap: '8px', color: '#111827', fontSize: '14px', lineHeight: 1.6 }}>
            {visibleBlocks.map((block, index) => <div key={index}>{renderRichTextBlock(block, t)}</div>)}
            {truncated && <div style={{ color: '#64748b', fontSize: '12px' }}>内容较长，完整报告请打开文件链接预览。</div>}
        </div>
    );
};

// ─── ECharts Widget ────────────────────────────────────────────────────────────

interface EChartsWidgetProps {
    widget: WidgetSpec;
    onDrill?: (dimension: string, value: string) => void;
}

const EChartsWidget: React.FC<EChartsWidgetProps> = ({ widget, onDrill }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<echarts.ECharts | null>(null);

    // init / update chart option
    useEffect(() => {
        if (!containerRef.current) return;
        if (!chartRef.current) {
            chartRef.current = echarts.init(containerRef.current, null, { renderer: 'canvas' });
        }
        chartRef.current.setOption(widget.config || {}, true);

        chartRef.current.off('click');
        chartRef.current.on('click', (params: any) => {
            onDrill?.(
                params.seriesName || params.dimensionNames?.[0] || 'value',
                String(params.name),
            );
        });
    }, [widget.config, onDrill]);

    // resize observer
    useEffect(() => {
        if (!containerRef.current) return;
        const ro = new ResizeObserver(() => chartRef.current?.resize());
        ro.observe(containerRef.current);
        return () => ro.disconnect();
    }, []);

    // cleanup on unmount
    useEffect(() => {
        return () => {
            chartRef.current?.dispose();
            chartRef.current = null;
        };
    }, []);

    return <div style={{ width: '100%', height: '360px' }} ref={containerRef} />;
};

// ─── Breadcrumb ────────────────────────────────────────────────────────────────

interface BreadcrumbProps {
    path: string[];
    onNavigate: (index: number) => void;
}

const Breadcrumb: React.FC<BreadcrumbProps> = ({ path, onNavigate }) => {
    if (path.length <= 1) return null;
    return (
        <nav aria-label="Breadcrumb" style={{ fontSize: 12, color: '#888', marginBottom: 8, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {path.map((item, i) => (
                <span key={i} style={{ display: 'flex', alignItems: 'center' }}>
                    {i > 0 && <span aria-hidden="true" style={{ margin: '0 4px', color: '#ccc' }}>›</span>}
                    {i < path.length - 1 ? (
                        <button
                            type="button"
                            onClick={() => onNavigate(i)}
                            style={{
                                cursor: 'pointer',
                                color: '#4e9cf7',
                                fontWeight: 400,
                                background: 'none',
                                border: 'none',
                                padding: 0,
                                font: 'inherit',
                                fontSize: 'inherit',
                            }}
                        >
                            {item}
                        </button>
                    ) : (
                        <span
                            style={{ color: '#333', fontWeight: 600 }}
                            aria-current="page"
                        >
                            {item}
                        </span>
                    )}
                </span>
            ))}
        </nav>
    );
};

// ─── FileLinkWidget ────────────────────────────────────────────────────────────

interface FileLinkWidgetProps {
    widget: WidgetSpec;
    t: (key: string) => string;
    currentSessionId?: string;
}

const FileLinkWidget: React.FC<FileLinkWidgetProps> = ({ widget, t, currentSessionId }) => {
    const { file_path, download_url, file_type, title, subtitle } = widget;
    const { openPreview } = usePreview();

    const fullUrl = resolveInternalUrl(download_url, currentSessionId);
    const previewUrl = resolveWorkspacePreviewUrl(download_url, currentSessionId);
    const normalizedFileType = (file_type || file_path?.split('.').pop() || '').toLowerCase();
    const canPreview = PREVIEWABLE_FILE_TYPES.has(normalizedFileType);

    const handleDownload = () => {
        if (fullUrl) {
            const link = document.createElement('a');
            link.href = fullUrl;
            link.download = file_path?.split('/').pop() || 'dashboard.html';
            link.click();
        }
    };

    const FileIcon = (() => {
        switch (normalizedFileType) {
            case 'html':
            case 'htm':
                return FileCode;
            case 'pdf':
                return FileText;
            case 'xlsx':
            case 'xls':
            case 'excel':
                return FileSpreadsheet;
            case 'png':
            case 'jpg':
            case 'jpeg':
            case 'gif':
            case 'webp':
            case 'svg':
                return Image;
            default:
                return File;
        }
    })();

    return (
        <div style={{
            border: '1px solid #e5e7eb',
            borderRadius: '8px',
            overflow: 'hidden',
            background: 'white'
        }}>
            <div style={{
                padding: '16px 20px',
                background: '#f9fafb',
                display: 'flex',
                alignItems: 'center',
                gap: '16px'
            }}>
                <div style={{ color: '#4b5563', display: 'flex', alignItems: 'center' }}><FileIcon size={30} /></div>
                <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '16px', fontWeight: 600, color: '#1f2937', marginBottom: '4px' }}>
                        {title}
                    </div>
                    {subtitle && (
                        <div style={{ fontSize: '13px', color: '#6b7280' }}>
                            {subtitle}
                        </div>
                    )}
                </div>
                <div className="agent-file-actions">
                    {canPreview && previewUrl && (
                        <button
                            type="button"
                            className="agent-file-action-btn"
                            onClick={() => openPreview(previewUrl, title || file_path || 'preview', normalizedFileType)}
                            title={t('widgets.preview') || '查看'}
                            aria-label={t('widgets.preview') || '查看'}
                        >
                            <Eye size={15} strokeWidth={2} />
                        </button>
                    )}
                    <button
                        type="button"
                        className="agent-file-action-btn"
                        onClick={handleDownload}
                        title={t('widgets.download') || '下载'}
                        aria-label={t('widgets.download') || '下载'}
                    >
                        <Download size={15} strokeWidth={2} />
                    </button>
                </div>
            </div>
        </div>
    );
};

// ─── WidgetRenderer ────────────────────────────────────────────────────────────

const WidgetRenderer: React.FC<WidgetRendererProps> = ({ widget, drillPath, onDrillDown, onBreadcrumbNavigate, currentSessionId }) => {
    const { t } = useLanguage();

    if (widget.status === 'previewing') {
        return null;
    }

    const body = (() => {
        if (widget.status === 'error') {
            return <div style={{ color: '#b91c1c', fontSize: '13px' }}>{widget.error || t('widgets.renderFail')}</div>;
        }

        switch (widget.kind) {
            case 'kpi':
            case 'metric_cards':
                return renderMetricCards(widget, t);
            case 'table':
                return renderTable(widget, t);
            case 'chart':
                return renderChart(widget, t);
            case 'steps':
                return renderSteps(widget, t);
            case 'rich_text':
                return renderRichText(widget, t);
            case 'echarts':
                return (
                    <>
                        <Breadcrumb
                            path={drillPath && drillPath.length > 0 ? drillPath : [widget.title]}
                            onNavigate={(i) => onBreadcrumbNavigate?.(widget.widget_id, i)}
                        />
                        <EChartsWidget
                            widget={widget}
                            onDrill={(dim, val) => onDrillDown?.(dim, val, widget.title, widget.widget_id)}
                        />
                    </>
                );
            case 'file_link':
                return <FileLinkWidget widget={widget} t={t} currentSessionId={currentSessionId} />;
            default:
                return <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: '12px' }}>{JSON.stringify(widget, null, 2)}</pre>;
        }
    })();

    return (
        <div style={{ border: '1px solid #e5e7eb', borderRadius: '14px', background: '#ffffff', padding: '14px', marginTop: '10px' }}>
            <div style={sectionTitleStyle}>{widget.title}</div>
            {widget.subtitle && <div style={sectionSubtitleStyle}>{widget.subtitle}</div>}
            <div style={{ marginTop: '12px' }}>{body}</div>
        </div>
    );
};

export default WidgetRenderer;
