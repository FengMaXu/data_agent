import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    X,
    ChevronUp,
    ChevronDown,
    Hammer,
    Code,
    Copy,
    Check,
    FileCode,
    Database,
    Terminal,
} from './icons/Typicons';
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
        let parsed: unknown = null;
        try {
            parsed = JSON.parse(trimmed);
        } catch {
            parsed = null;
        }
        if (parsed !== null) return <JsonHighlight data={parsed} />;
    }

    return <pre className="formatted-text">{result}</pre>;
};

type ThreadSectionProps = {
    label: string;
    copyText?: string;
    copyKey: string;
    copiedKey: string | null;
    onCopy: (text: string, key: string) => void;
    scroll?: boolean;
    children: React.ReactNode;
};

const ThreadSection: React.FC<ThreadSectionProps> = ({ label, copyText, copyKey, copiedKey, onCopy, scroll, children }) => {
    const { t } = useLanguage();
    return (
        <section className="thread-section">
            <div className="thread-section-label">
                <span>{label}</span>
                {copyText && (
                    <button type="button" className="copy-btn" onClick={() => onCopy(copyText, copyKey)} title={t('tools.copy')} aria-label={t('tools.copy')}>
                        {copiedKey === copyKey ? <Check size={12} color="#10b981" /> : <Copy size={12} />}
                    </button>
                )}
            </div>
            <div className={`thread-section-body ${scroll ? 'is-scroll' : ''}`}>{children}</div>
        </section>
    );
};

type ThreadItemProps = {
    tool: ToolData;
    index: number;
    open: boolean;
    onToggle: () => void;
    copiedKey: string | null;
    onCopy: (text: string, key: string) => void;
};

const ThreadItem: React.FC<ThreadItemProps> = ({ tool, index, open, onToggle, copiedKey, onCopy }) => {
    const { t } = useLanguage();
    const contentId = `tool-thread-content-${tool.toolCallId}`;
    const argsText = typeof tool.args === 'string' ? tool.args : JSON.stringify(tool.args, null, 2);
    const detailsText = tool.details ? JSON.stringify(tool.details, null, 2) : '';
    const tone = tool.status === 'error' ? 'error' : tool.status === 'done' ? 'success' : 'running';
    const statusLabel = tool.status === 'error' ? t('tools.statusError') : tool.status === 'done' ? t('tools.statusDone') : t('tools.statusRunning');

    return (
        <li className={`thread-item is-${tone} ${open ? 'is-open' : ''}`}>
            <span className="thread-node" aria-hidden="true" />
            <button
                type="button"
                className="thread-head"
                aria-expanded={open}
                aria-controls={contentId}
                onClick={onToggle}
            >
                <span className="thread-index">{String(index + 1).padStart(2, '0')}</span>
                <span className="thread-icon" aria-hidden="true">{getToolIcon(tool.name)}</span>
                <span className="thread-name" title={tool.name}>{tool.name}</span>
                <span className={`thread-status is-${tone}`}>{statusLabel}</span>
                <span className="thread-chevron" aria-hidden="true">
                    {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </span>
            </button>

            {open && (
                <div id={contentId} className="thread-body">
                    {tool.args && (
                        <ThreadSection label={t('tools.args')} copyText={argsText} copyKey={`args-${tool.toolCallId}`} copiedKey={copiedKey} onCopy={onCopy}>
                            <ArgsRenderer args={tool.args} />
                        </ThreadSection>
                    )}

                    {tool.widget && (
                        <ThreadSection label="Widget Spec" copyText={JSON.stringify(tool.widget, null, 2)} copyKey={`widget-${tool.toolCallId}`} copiedKey={copiedKey} onCopy={onCopy} scroll>
                            <JsonHighlight data={tool.widget} />
                        </ThreadSection>
                    )}

                    {tool.details && !tool.widget && (
                        <ThreadSection label={t('tools.details')} copyText={detailsText} copyKey={`details-${tool.toolCallId}`} copiedKey={copiedKey} onCopy={onCopy} scroll>
                            <JsonHighlight data={tool.details} />
                        </ThreadSection>
                    )}

                    <ThreadSection label={t('tools.result')} copyText={tool.result || undefined} copyKey={`result-${tool.toolCallId}`} copiedKey={copiedKey} onCopy={onCopy} scroll>
                        <ResultRenderer result={tool.result} />
                    </ThreadSection>
                </div>
            )}
        </li>
    );
};

const ToolPanel: React.FC<ToolPanelProps> = ({ tools = [], onClose }) => {
    const { t } = useLanguage();
    const { copiedKey, copy } = useCopy();
    const contentRef = useRef<HTMLDivElement>(null);
    // Explicit open/closed choices; untouched steps default to open only when latest or failed.
    const [openOverrides, setOpenOverrides] = useState<Record<string, boolean>>({});
    const lastToolId = tools[tools.length - 1]?.toolCallId;

    // The thread reads top-down in call order, so follow it to the newest step.
    useEffect(() => {
        if (!contentRef.current) {
            return;
        }
        contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }, [tools.length]);

    return (
        <aside className="tool-panel">
            <div className="tool-panel-header">
                <div className="tool-panel-header-main">
                    <span className="tool-panel-title">{t('tools.details')}</span>
                    <span className="tool-panel-count">{tools.length}</span>
                </div>
                <button type="button" className="close-btn" onClick={onClose} aria-label={t('common.close')} title={t('common.close')}>
                    <X size={16} aria-hidden="true" />
                </button>
            </div>

            <div ref={contentRef} className="tool-panel-content scrollable-area">
                {tools.length === 0 ? (
                    <div className="tool-panel-empty">
                        <strong>{t('tools.noCalls')}</strong>
                        <span>{t('tools.noCallsHint')}</span>
                    </div>
                ) : (
                    <ol className="tool-thread">
                        {tools.map((tool, index) => {
                            const open = openOverrides[tool.toolCallId] ?? (tool.toolCallId === lastToolId || tool.status === 'error');
                            return (
                                <ThreadItem
                                    key={tool.toolCallId}
                                    tool={tool}
                                    index={index}
                                    open={open}
                                    onToggle={() => setOpenOverrides((prev) => ({ ...prev, [tool.toolCallId]: !open }))}
                                    copiedKey={copiedKey}
                                    onCopy={copy}
                                />
                            );
                        })}
                    </ol>
                )}
            </div>
        </aside>
    );
};

export default ToolPanel;
