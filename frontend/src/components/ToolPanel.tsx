import React, { useState, useCallback } from 'react';
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
    Terminal
} from 'lucide-react';

export interface ToolData {
    name: string;
    args: any;
    result?: string;
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

/* ──────── Helper: copy to clipboard ──────── */
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

/* ──────── Helper: get tool icon ──────── */
const getToolIcon = (name: string) => {
    const n = name.toLowerCase();
    if (n.includes('sql') || n.includes('query') || n.includes('database') || n.includes('mysql')) return <Database size={14} />;
    if (n.includes('code') || n.includes('execute') || n.includes('python') || n.includes('script')) return <Terminal size={14} />;
    if (n.includes('file') || n.includes('read') || n.includes('write')) return <FileCode size={14} />;
    return <Hammer size={14} />;
};

/* ──────── JSON Syntax Highlighter ──────── */
const JsonHighlight: React.FC<{ data: any }> = ({ data }) => {
    const jsonStr = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    // Tokenize JSON for coloring
    const highlighted = jsonStr.replace(
        /("(?:\\.|[^"\\])*")\s*:/g, // keys
        '<span class="json-key">$1</span>:'
    ).replace(
        /:\s*("(?:\\.|[^"\\])*")/g, // string values
        ': <span class="json-string">$1</span>'
    ).replace(
        /:\s*(\d+\.?\d*)/g, // numbers
        ': <span class="json-number">$1</span>'
    ).replace(
        /:\s*(true|false)/g, // booleans
        ': <span class="json-bool">$1</span>'
    ).replace(
        /:\s*(null)/g, // null
        ': <span class="json-null">$1</span>'
    );
    return <pre className="json-highlight" dangerouslySetInnerHTML={{ __html: highlighted }} />;
};

/* ──────── Code Block with line numbers ──────── */
const CodeBlock: React.FC<{ code: string; language?: string }> = ({ code }) => {
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

/* ──────── Smart args renderer ──────── */
const ArgsRenderer: React.FC<{ args: any }> = ({ args }) => {
    const argsObj = typeof args === 'string' ? (() => { try { return JSON.parse(args); } catch { return null; } })() : args;

    if (!argsObj || typeof argsObj !== 'object') {
        return <pre className="formatted-text">{typeof args === 'string' ? args : JSON.stringify(args, null, 2)}</pre>;
    }

    // If args has a 'code' field, render it specially
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
                    <CodeBlock code={String(codeContent)} language={sql || query ? 'sql' : 'python'} />
                </div>
            )}
            {!codeContent && !hasOtherFields && (
                <JsonHighlight data={argsObj} />
            )}
        </div>
    );
};

/* ──────── Smart result renderer ──────── */
const ResultRenderer: React.FC<{ result: string }> = ({ result }) => {
    if (!result) {
        return <span className="result-pending">执行中...</span>;
    }

    // Try to detect and parse JSON
    const trimmed = result.trim();
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
        try {
            const parsed = JSON.parse(trimmed);
            return <JsonHighlight data={parsed} />;
        } catch {
            // not valid JSON, render as text
        }
    }

    // Render as formatted text, preserving newlines
    return <pre className="formatted-text">{result}</pre>;
};

/* ──────── Collapsible Tool Card ──────── */
const ToolCard: React.FC<{ tool: ToolData; index: number; copiedKey: string | null; onCopy: (text: string, key: string) => void }> = ({ tool, index, copiedKey, onCopy }) => {
    const [collapsed, setCollapsed] = useState(false);

    const argsText = typeof tool.args === 'string' ? tool.args : JSON.stringify(tool.args, null, 2);
    const isSkillActivation = tool.name === 'activate_skill';

    return (
        <div className={`tool-card ${collapsed ? 'collapsed' : ''}`}>
            <div className="tool-card-header" onClick={() => setCollapsed(!collapsed)}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {getToolIcon(tool.name)}
                    <span>{isSkillActivation && tool.skill ? `激活技能 · ${tool.skill.name}` : tool.name}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    {tool.result ? (
                        <span className="tool-status-badge success">完成</span>
                    ) : (
                        <span className="tool-status-badge running">执行中</span>
                    )}
                    {collapsed ? <ChevronDown size={16} color="#6b7280" /> : <ChevronUp size={16} color="#6b7280" />}
                </div>
            </div>

            {!collapsed && (
                <>
                    {isSkillActivation && tool.skill && (
                        <div className="tool-card-section">
                            <div className="section-title">
                                <Hammer size={14} />
                                <span>技能信息</span>
                            </div>
                            <div className="code-block-formatted result-block" style={{ display: 'grid', gap: '6px' }}>
                                <div><strong>名称：</strong>{tool.skill.name}</div>
                                {tool.skill.description && <div><strong>描述：</strong>{tool.skill.description}</div>}
                                {tool.skill.when_to_use && <div><strong>使用时机：</strong>{tool.skill.when_to_use}</div>}
                                {tool.skill.source_scope && <div><strong>来源：</strong>{tool.skill.source_scope}</div>}
                                {tool.skill.location && <div><strong>路径：</strong>{tool.skill.location}</div>}
                                {tool.skill.granted_permissions && tool.skill.granted_permissions.length > 0 && (
                                    <div><strong>声明权限：</strong>{tool.skill.granted_permissions.join(', ')}</div>
                                )}
                                {tool.skill.model_override && <div><strong>模型偏好：</strong>{tool.skill.model_override}</div>}
                            </div>
                        </div>
                    )}

                    {tool.args && (
                        <div className="tool-card-section">
                            <div className="section-title">
                                <Code size={14} />
                                <span>工具参数</span>
                                <button
                                    className="copy-btn"
                                    onClick={() => onCopy(argsText, `args-${index}`)}
                                    title="复制"
                                >
                                    {copiedKey === `args-${index}` ? <Check size={13} color="#10b981" /> : <Copy size={13} />}
                                </button>
                            </div>
                            <div className="code-block-formatted">
                                <ArgsRenderer args={tool.args} />
                            </div>
                        </div>
                    )}

                    <div className="tool-card-section">
                        <div className="section-title">
                            <ListTree size={14} />
                            <span>工具结果</span>
                            {tool.result && (
                                <button
                                    className="copy-btn"
                                    onClick={() => onCopy(tool.result || '', `result-${index}`)}
                                    title="复制"
                                >
                                    {copiedKey === `result-${index}` ? <Check size={13} color="#10b981" /> : <Copy size={13} />}
                                </button>
                            )}
                        </div>
                        <div className="code-block-formatted result-block">
                            <ResultRenderer result={tool.result || ''} />
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};

/* ──────── Main Panel ──────── */
const ToolPanel: React.FC<ToolPanelProps> = ({ tools = [], onClose }) => {
    const { copiedKey, copy } = useCopy();

    return (
        <aside className="tool-panel">
            <div className="tool-panel-header">
                <span>详细信息</span>
                <button className="close-btn" onClick={onClose}>
                    <X size={16} />
                </button>
            </div>

            <div className="tool-panel-content scrollable-area">
                {tools.length === 0 && (
                    <div style={{ padding: '20px', textAlign: 'center', color: '#9ca3af', fontSize: '13px' }}>
                        暂无工具调用
                    </div>
                )}

                {tools.map((tool, idx) => (
                    <ToolCard
                        key={idx}
                        tool={tool}
                        index={idx}
                        copiedKey={copiedKey}
                        onCopy={copy}
                    />
                ))}
            </div>
        </aside>
    );
};

export default ToolPanel;
