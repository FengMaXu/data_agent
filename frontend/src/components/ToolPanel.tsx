import React from 'react';
import {
    X,
    ChevronUp,
    Hammer,
    Code,
    ListTree,
    Copy
} from 'lucide-react';

export interface ToolData {
    name: string;
    args: any;
    result?: string;
}

interface ToolPanelProps {
    tools?: ToolData[];
    onClose?: () => void;
}

const ToolPanel: React.FC<ToolPanelProps> = ({ tools = [], onClose }) => {
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
                    <div className="tool-card" key={idx}>
                        <div className="tool-card-header">
                            <span>{tool.name}</span>
                            <div style={{ background: '#f3f4f6', borderRadius: '4px', padding: '2px 4px', cursor: 'pointer' }}>
                                <ChevronUp size={16} color="#6b7280" />
                            </div>
                        </div>

                        <div className="tool-card-section">
                            <div className="section-title">
                                <Hammer size={14} />
                                <span>工具名称</span>
                            </div>
                            <div className="code-block" style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <span style={{ fontWeight: 500 }}>{tool.name}</span>
                                <Copy size={14} className="copy-icon" />
                            </div>
                        </div>

                        {tool.args && (
                            <div className="tool-card-section">
                                <div className="section-title">
                                    <Code size={14} />
                                    <span>工具参数</span>
                                </div>
                                <div className="code-block" style={{ display: 'flex', justifyContent: 'space-between', paddingRight: '32px' }}>
                                    <span style={{ lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                                        {typeof tool.args === 'string' ? tool.args : JSON.stringify(tool.args, null, 2)}
                                    </span>
                                    <Copy size={14} className="copy-icon" />
                                </div>
                            </div>
                        )}

                        <div className="tool-card-section">
                            <div className="section-title">
                                <ListTree size={14} />
                                <span>工具结果</span>
                            </div>
                            <div className="code-block" style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <span style={{ color: '#6b7280', overflow: 'hidden', whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: '200px', overflowY: 'auto', display: 'block' }}>
                                    {tool.result || '执行中...'}
                                </span>
                                <Copy size={14} className="copy-icon" />
                            </div>
                        </div>
                    </div>
                ))}

            </div>
        </aside>
    );
};

export default ToolPanel;
