import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    X,
    ChevronUp,
    ChevronDown,
    Hammer,
    Code,
    ListTree,
    Copy,
    Check,
    FileCode,
    Database,
    Terminal,
} from 'lucide-react';
import type { WidgetSpec } from '../api/client';
import { useLanguage } from '../context/LanguageContext';

export interface ToolData {
    toolCallId: string;
    messageId: string;
    name: string;
    args: any;
    result?: string;
    details?: any;
    status: 'calling' | 'running' | 'done' | 'error';
    widgetId?: string | null;
    widget?: WidgetSpec;
    skill?: {
        name: string;
        description?: string;
        when_to_use?: string;
        location?: string;
        source_scope?: string;
        granted_permissions?: string[];
        model_override?: string | null;
        ui_message?: string;
    };
}

interface ToolPanelProps {
    tools?: ToolData[];
    onClose?: () => void;
}

const useCopy = () => {
    const [copiedKey, setCopiedKey] = useState<string | null>(null);
    const copy = useCallback((text: string, key: string) => {
        navigator.clipboard.writeText(text).then(() => {
            setCopiedKey(key);
            setTimeout(() => setCopiedKey(null), 2000);
        });
    }, []);
    return { copiedKey, copy };
};

const getToolIcon = (name: string) => {
    const n = name.toLowerCase();
    if (n.includes('sql') || n.includes('query') || n.includes('database') || n.includes('mysql')) return <Database size={14} />;
    if (n.includes('code') || n.includes('execute') || n.includes('python') || n.includes('script')) return <Terminal size={14} />;
    if (n.includes('file') || n.includes('read') || n.includes('write')) return <FileCode size={14} />;
    return <Hammer size={14} />;
};

const JsonHighlight: React.FC<{ data: any }> = ({ data }) => {
    const jsonStr = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    return <pre className="json-highlight">{jsonStr}</pre>;
};

const CodeBlock: React.FC<{ code: string }> = ({ code }) => {
    const lines = code.split('\n');
    return (
        <div className="code-highlight">
            <table className="code-table">
                <tbody>
                    {lines.map((line, i) => (
                        <tr key={i}>
                            <td className="line-number">{i + 1}</td>
                            <td className="line-content">{line || ' '}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
};

const ArgsRenderer: React.FC<{ args: any }> = ({ args }) => {
    const argsObj = typeof args === 'string' ? (() => { try { return JSON.parse(args); } catch { return null; } })() : args;

    if (!argsObj || typeof argsObj !== 'object') {
        return <pre className="formatted-text">{typeof args === 'string' ? args : JSON.stringify(args, null, 2)}</pre>;
    }

    const { code, query, sql, ...rest } = argsObj;
    const codeContent = code || query || sql;
    const hasOtherFields = Object.keys(rest).length > 0;

    return (
        <div className="args-formatted">
            {hasOtherFields && (
                <div className="args-fields">
                    {Object.entries(rest).map(([key, value]) => (
                        <div className="arg-field" key={key}>
                            <span className="arg-label">{key}</span>
                            <span className="arg-value">
                                {typeof value === 'string' ? value : JSON.stringify(value)}
                            </span>
                        </div>
                    ))}
                </div>
            )}
            {codeContent && (
                <div className="args-code-section">
                    <div className="args-code-label">
                        <Code size={12} />
                        <span>{code ? 'Code' : query ? 'Query' : 'SQL'}</span>
                    </div>
                    <CodeBlock code={String(codeContent)} />
                </div>
            )}
            {!codeContent && !hasOtherFields && <JsonHighlight data={argsObj} />}
        </div>
    );
};

const ResultRenderer: React.FC<{ result?: string }> = ({ result }) => {
    const { t } = useLanguage();
    if (!result) {
        return <span className="result-pending">{t('tools.processing')}</span>;
    }

    const trimmed = result.trim();
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
        try {
            const parsed = JSON.parse(trimmed);
            return <JsonHighlight data={parsed} />;
        } catch {
            // ignore
        }
    }

    return <pre className="formatted-text">{result}</pre>;
};

const ToolCard: React.FC<{ tool: ToolData; copiedKey: string | null; onCopy: (text: string, key: string) => void }> = ({ tool, copiedKey, onCopy }) => {
    const { t } = useLanguage();
    const [collapsed, setCollapsed] = useState(false);
    const argsText = typeof tool.args === 'string' ? tool.args : JSON.stringify(tool.args, null, 2);
    const detailsText = tool.details ? JSON.stringify(tool.details, null, 2) : '';

    return (
        <div className={`tool-card ${collapsed ? 'collapsed' : ''}`}>
            <div className="tool-card-header" onClick={() => setCollapsed(!collapsed)}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {getToolIcon(tool.name)}
                    <span>{tool.name}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span className={`tool-status-badge ${tool.status === 'error' ? 'running' : tool.status === 'done' ? 'success' : 'running'}`}>
                        {tool.status === 'error' ? t('tools.statusError') : tool.status === 'done' ? t('tools.statusDone') : t('tools.statusRunning')}
                    </span>
                    {collapsed ? <ChevronDown size={16} color="#6b7280" /> : <ChevronUp size={16} color="#6b7280" />}
                </div>
            </div>

            {!collapsed && (
                <>
                    {tool.args && (
                        <div className="tool-card-section">
                            <div className="section-title">
                                <Code size={14} />
                                <span>{t('tools.args')}</span>
                                <button className="copy-btn" onClick={() => onCopy(argsText, `args-${tool.toolCallId}`)} title={t('tools.copy') || "复制"}>
                                    {copiedKey === `args-${tool.toolCallId}` ? <Check size={13} color="#10b981" /> : <Copy size={13} />}
                                </button>
                            </div>
                            <div className="code-block-formatted">
                                <ArgsRenderer args={tool.args} />
                            </div>
                        </div>
                    )}

                    {tool.widget && (
                        <div className="tool-card-section">
                            <div className="section-title">
                                <ListTree size={14} />
                                <span>Widget Spec</span>
                                <button className="copy-btn" onClick={() => onCopy(JSON.stringify(tool.widget, null, 2), `widget-${tool.toolCallId}`)} title={t('tools.copy') || "复制"}>
                                    {copiedKey === `widget-${tool.toolCallId}` ? <Check size={13} color="#10b981" /> : <Copy size={13} />}
                                </button>
                            </div>
                            <div className="code-block-formatted result-block">
                                <JsonHighlight data={tool.widget} />
                            </div>
                        </div>
                    )}

                    {tool.details && !tool.widget && (
                        <div className="tool-card-section">
                            <div className="section-title">
                                <ListTree size={14} />
                                <span>{t('tools.details')}</span>
                                <button className="copy-btn" onClick={() => onCopy(detailsText, `details-${tool.toolCallId}`)} title={t('tools.copy') || "复制"}>
                                    {copiedKey === `details-${tool.toolCallId}` ? <Check size={13} color="#10b981" /> : <Copy size={13} />}
                                </button>
                            </div>
                            <div className="code-block-formatted result-block">
                                <JsonHighlight data={tool.details} />
                            </div>
                        </div>
                    )}

                    <div className="tool-card-section">
                        <div className="section-title">
                            <ListTree size={14} />
                            <span>{t('tools.result')}</span>
                            {tool.result && (
                                <button className="copy-btn" onClick={() => onCopy(tool.result || '', `result-${tool.toolCallId}`)} title={t('tools.copy') || "复制"}>
                                    {copiedKey === `result-${tool.toolCallId}` ? <Check size={13} color="#10b981" /> : <Copy size={13} />}
                                </button>
                            )}
                        </div>
                        <div className="code-block-formatted result-block">
                            <ResultRenderer result={tool.result} />
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};

const ToolPanel: React.FC<ToolPanelProps> = ({ tools = [], onClose }) => {
    const { t } = useLanguage();
    const { copiedKey, copy } = useCopy();
    const contentRef = useRef<HTMLDivElement>(null);
    const orderedTools = useMemo(() => [...tools].reverse(), [tools]);

    useEffect(() => {
        if (!contentRef.current) {
            return;
        }
        contentRef.current.scrollTop = 0;
    }, [orderedTools]);

    return (
        <aside className="tool-panel">
            <div className="tool-panel-header">
                <div className="tool-panel-header-main">
                    <span className="tool-panel-title">{t('tools.details')}</span>
                    <span className="tool-panel-count">{orderedTools.length}</span>
                </div>
                <button type="button" className="close-btn" onClick={onClose}>
                    <X size={16} />
                </button>
            </div>

            <div ref={contentRef} className="tool-panel-content scrollable-area">
                {orderedTools.length === 0 && (
                    <div className="tool-panel-empty">
                        {t('tools.noCalls')}
                    </div>
                )}

                {orderedTools.map((tool) => (
                    <ToolCard
                        key={tool.toolCallId}
                        tool={tool}
                        copiedKey={copiedKey}
                        onCopy={copy}
                    />
                ))}
            </div>
        </aside>
    );
};

export default ToolPanel;
