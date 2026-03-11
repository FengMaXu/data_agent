import React, { useState, useRef, useEffect } from 'react';
import {
    Orbit,
    PenTool,
    Loader2,
    Send,
    Trash2,
    Paperclip
} from 'lucide-react';
import { sendChatMessage, steerAgent, clearSession, type SSEEvent } from '../api/client';
import type { ToolData } from './ToolPanel';
import { useSession } from '../hooks/useSession';

interface Message {
    id: string;
    role: 'user' | 'agent';
    content: string;
    toolCalls?: { name: string; arguments: any }[];
    toolResults?: { name: string; content: string }[];
    skillActivations?: {
        name: string;
        description?: string;
        when_to_use?: string;
        location?: string;
        source_scope?: string;
        granted_permissions?: string[];
        model_override?: string | null;
        ui_message?: string;
    }[];
}

interface ChatAreaProps {
    onUpdateTools?: (tools: ToolData[]) => void;
}

const ChatArea: React.FC<ChatAreaProps> = ({ onUpdateTools }) => {
    const { currentSession } = useSession();

    const [inputValue, setInputValue] = useState('');
    const [messages, setMessages] = useState<Message[]>([]);
    const [isStreaming, setIsStreaming] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [shouldAutoScroll, setShouldAutoScroll] = useState(true);
    const activeAgentMsgIdRef = useRef<string | null>(null);

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const chatContainerRef = useRef<HTMLDivElement>(null);
    const onUpdateToolsRef = useRef(onUpdateTools);

    // 缓冲池引用——供 SSE 回调闭包使用
    const agentBufferRef = useRef<Message | null>(null);

    useEffect(() => {
        onUpdateToolsRef.current = onUpdateTools;
    }, [onUpdateTools]);

    // Update tools when messages change
    useEffect(() => {
        const allTools = messages.flatMap(msg => {
            if (!msg.toolCalls) return [];
            return msg.toolCalls.map(tc => {
                const result = msg.toolResults?.find(tr => tr.name === tc.name)?.content;
                const skill = tc.name === 'activate_skill'
                    ? msg.skillActivations?.find(sa => sa.name === tc.arguments?.command)
                    : undefined;
                return {
                    name: tc.name,
                    args: tc.arguments,
                    result: result,
                    skill,
                };
            });
        });
        if (allTools.length > 0 && onUpdateToolsRef.current) {
            onUpdateToolsRef.current(allTools);
        }
    }, [messages]);

    // Auto-scroll
    useEffect(() => {
        if (shouldAutoScroll) {
            messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }
    }, [messages, shouldAutoScroll]);

    // Clear messages when session changes
    useEffect(() => {
        setMessages([]);
        activeAgentMsgIdRef.current = null;
        agentBufferRef.current = null;
        if (onUpdateToolsRef.current) onUpdateToolsRef.current([]);
    }, [currentSession.id]);

    const handleScroll = () => {
        if (!chatContainerRef.current) return;
        const { scrollTop, scrollHeight, clientHeight } = chatContainerRef.current;
        const isNearBottom = scrollHeight - scrollTop - clientHeight < 100;
        setShouldAutoScroll(isNearBottom);
    };

    /**
     * 将缓冲池刷入 React state
     */
    const flushBuffer = () => {
        const buf = agentBufferRef.current;
        const targetId = activeAgentMsgIdRef.current;
        if (!buf || !targetId) return;
        const cloned = { ...buf };
        setMessages(prev => prev.map(m => m.id === targetId ? cloned : m));
    };

    const handleSend = async () => {
        if (!inputValue.trim()) return;

        const currentSessionId = currentSession.id;
        const content = inputValue.trim();

        const userMsg: Message = {
            id: Date.now().toString(),
            role: 'user',
            content: content,
        };

        // ── Steering: agent 正在运行时发送追加消息 ──
        if (isStreaming) {
            // 1. 先冻结当前 agent 气泡的内容（把缓冲池刷入 state）
            flushBuffer();

            // 2. 创建新的 agent 气泡
            const newAgentMsgId = (Date.now() + 1).toString();
            const newAgentMsg: Message = {
                id: newAgentMsgId,
                role: 'agent',
                content: '',
                toolCalls: [],
                toolResults: []
            };

            // 3. 切换 activeAgentMsgIdRef 和缓冲池到新气泡
            activeAgentMsgIdRef.current = newAgentMsgId;
            agentBufferRef.current = { ...newAgentMsg };

            setMessages(prev => [...prev, userMsg, newAgentMsg]);
            setInputValue('');
            setShouldAutoScroll(true);

            try {
                await steerAgent(content, currentSessionId);
            } catch (err) {
                console.error("Failed to steer agent:", err);
            }
            return;
        }

        // ── 正常发送 ──
        const agentMsgId = (Date.now() + 1).toString();
        const initialAgentMsg: Message = {
            id: agentMsgId,
            role: 'agent',
            content: '',
            toolCalls: [],
            toolResults: []
        };

        setMessages(prev => [...prev, userMsg, initialAgentMsg]);
        activeAgentMsgIdRef.current = agentMsgId;
        agentBufferRef.current = { ...initialAgentMsg };
        setInputValue('');
        setIsStreaming(true);
        setShouldAutoScroll(true);

        let lastUpdateTime = Date.now();
        let flushTimer: ReturnType<typeof setTimeout> | null = null;

        await sendChatMessage(
            content,
            (event: SSEEvent) => {
                const buf = agentBufferRef.current;
                if (!buf) return;

                let needsImmediateUpdate = false;

                if (event.type === 'text_delta') {
                    buf.content += event.content;
                } else if (event.type === 'tool_call') {
                    buf.toolCalls = [
                        ...(buf.toolCalls || []),
                        { name: event.name, arguments: event.arguments }
                    ];
                    buf.content += `\n\n  🔧 调用工具: ${event.name}\n\n`;
                    needsImmediateUpdate = true;
                } else if (event.type === 'tool_result') {
                    buf.toolResults = [
                        ...(buf.toolResults || []),
                        { name: event.name, content: event.content }
                    ];
                    if (event.name === 'activate_skill') {
                        try {
                            const parsed = JSON.parse(event.content);
                            const skillMeta = parsed?.skill;
                            if (skillMeta?.name) {
                                buf.skillActivations = [
                                    ...(buf.skillActivations || []),
                                    {
                                        name: skillMeta.name,
                                        description: skillMeta.description,
                                        when_to_use: skillMeta.when_to_use,
                                        location: skillMeta.location,
                                        source_scope: skillMeta.source_scope,
                                        granted_permissions: parsed.granted_permissions,
                                        model_override: parsed.model_override,
                                        ui_message: parsed.ui_message,
                                    }
                                ];
                            }
                        } catch {
                            const match = event.content.match(/The \"([^\"]+)\" skill is loading/);
                            if (match?.[1]) {
                                buf.skillActivations = [
                                    ...(buf.skillActivations || []),
                                    { name: match[1], ui_message: event.content }
                                ];
                            }
                        }
                    }
                    needsImmediateUpdate = true;
                } else if (event.type === 'skill_activated') {
                    buf.skillActivations = [
                        ...(buf.skillActivations || []),
                        {
                            name: event.skill.name,
                            description: event.skill.description,
                            when_to_use: event.skill.when_to_use,
                            location: event.skill.location,
                            source_scope: event.skill.source_scope,
                            granted_permissions: event.skill.granted_permissions,
                            model_override: event.skill.model_override,
                            ui_message: event.skill.ui_message,
                        }
                    ];
                    needsImmediateUpdate = true;
                } else if (event.type === 'workspace_updated') {
                    window.dispatchEvent(new CustomEvent('workspace_updated'));
                } else if (event.type === 'error') {
                    buf.content += `\n\n**Error:** ${event.error}`;
                    needsImmediateUpdate = true;
                }

                // 节流刷新
                const now = Date.now();
                if (event.type === 'done' || needsImmediateUpdate || now - lastUpdateTime > 60) {
                    flushBuffer();
                    lastUpdateTime = now;
                    if (flushTimer) {
                        clearTimeout(flushTimer);
                        flushTimer = null;
                    }
                } else if (!flushTimer) {
                    flushTimer = setTimeout(() => {
                        flushBuffer();
                        lastUpdateTime = Date.now();
                        flushTimer = null;
                    }, 60);
                }
            },
            (err) => {
                console.error("Chat error:", err);
                setIsStreaming(false);
            },
            () => {
                // 结束时最终刷新一次
                if (flushTimer) {
                    clearTimeout(flushTimer);
                    flushTimer = null;
                }
                flushBuffer();
                setIsStreaming(false);
                activeAgentMsgIdRef.current = null;
                agentBufferRef.current = null;
            },
            currentSessionId
        );
    };

    const handleClearSession = async () => {
        if (isStreaming) return;
        setMessages([]);
        activeAgentMsgIdRef.current = null;
        agentBufferRef.current = null;
        if (onUpdateToolsRef.current) onUpdateToolsRef.current([]);
        try {
            await clearSession(currentSession.id);
        } catch (e) {
            console.error("Failed to clear session on backend", e);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files || files.length === 0) return;

        setUploading(true);
        try {
            const uploadFn = (window as any).handleWorkspaceUpload;
            if (uploadFn) {
                await uploadFn(files);
            } else {
                console.error('Upload function not available');
            }
        } catch (e) {
            console.error('Upload failed:', e);
        } finally {
            setUploading(false);
            e.target.value = '';
        }
    };

    return (
        <main className="chat-area">
            {/* Breadcrumb Header */}
            <header className="breadcrumb-header" style={{ justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Orbit size={16} className="breadcrumb-icon" />
                    <span style={{ color: '#1f2937', fontWeight: 600 }}>Agents</span>
                    <span className="breadcrumb-separator">/</span>
                    <span style={{ fontWeight: 400 }}>当前会话</span>
                </div>

                <button
                    onClick={handleClearSession}
                    disabled={isStreaming}
                    style={{
                        background: 'transparent', border: 'none', cursor: isStreaming ? 'not-allowed' : 'pointer',
                        display: 'flex', alignItems: 'center', gap: '6px', color: '#6b7280', padding: '6px 12px',
                        borderRadius: '6px', transition: 'background 0.2s', opacity: messages.length === 0 ? 0.5 : 1
                    }}
                    onMouseOver={e => !isStreaming && (e.currentTarget.style.background = '#f3f4f6')}
                    onMouseOut={e => !isStreaming && (e.currentTarget.style.background = 'transparent')}
                >
                    <Trash2 size={14} />
                    <span>清空对话</span>
                </button>
            </header>

            <div
                ref={chatContainerRef}
                onScroll={handleScroll}
                className="chat-message-list scrollable-area flex flex-col gap-6 p-6"
            >
                {messages.length === 0 && (
                    <div style={{ textAlign: 'center', color: '#9ca3af', marginTop: '100px' }}>
                        发送一条消息开始会话...
                    </div>
                )}

                {messages.map(msg => (
                    <React.Fragment key={msg.id}>
                        {msg.role === 'user' ? (
                            <div className="message user self-end max-w-[80%]" style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginLeft: 'auto', flexDirection: 'row', alignItems: 'flex-start' }}>
                                <div className="message-content shadow-sm" style={{ background: '#f3f4f6', padding: '12px 16px', borderRadius: '16px', borderTopRightRadius: '4px', color: '#1f2937' }}>
                                    {msg.content}
                                </div>
                                <div className="message-avatar flex-shrink-0 flex items-center justify-center w-8 h-8 rounded-full" style={{ background: '#1f2937', color: '#fff', fontSize: '14px' }}>U</div>
                            </div>
                        ) : (
                            <div className="message agent max-w-[85%]" style={{ display: 'flex', gap: '12px' }}>
                                <div className="agent-icon-red flex-shrink-0 flex items-center justify-center w-8 h-8 rounded mt-1" style={{ background: '#fee2e2' }}>
                                    <Orbit size={18} color="#f04438" />
                                </div>
                                <div className="message-content-wrapper" style={{ flex: 1, minWidth: 0 }}>

                                    {/* Tool Calls Status */}
                                    {msg.toolCalls && msg.toolCalls.length > 0 && (
                                        <div className="agent-status-bar" style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#6b7280', fontSize: '13px', marginBottom: '8px', background: '#f9fafb', padding: '6px 12px', borderRadius: '6px', border: '1px solid #f3f4f6', width: 'fit-content' }}>
                                            <PenTool size={14} />
                                            <span>{msg.toolCalls.length} 个工具调用</span>
                                            {isStreaming && msg.id === activeAgentMsgIdRef.current && (
                                                <Loader2 size={12} className="animate-spin ml-2" />
                                            )}
                                        </div>
                                    )}

                                    {/* Tool Results Details */}
                                    {msg.toolResults && msg.toolResults.length > 0 && (
                                        <div className="agent-loading-line truncate" style={{ fontSize: '13px', color: '#9ca3af', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
                                            <span style={{ color: '#10b981' }}>✓</span>
                                            <span>完成: {msg.toolResults[msg.toolResults.length - 1].name}</span>
                                        </div>
                                    )}

                                    {msg.skillActivations && msg.skillActivations.length > 0 && (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '10px' }}>
                                            {msg.skillActivations.map((skill, index) => (
                                                <div key={`${skill.name}-${index}`} style={{ background: '#fff7ed', border: '1px solid #fdba74', borderRadius: '10px', padding: '10px 12px', color: '#9a3412' }}>
                                                    <div style={{ fontSize: '12px', fontWeight: 700, marginBottom: '4px' }}>Skill 已激活</div>
                                                    <div style={{ fontSize: '14px', fontWeight: 600 }}>{skill.name}</div>
                                                    {skill.description && <div style={{ fontSize: '13px', marginTop: '4px' }}>{skill.description}</div>}
                                                    {skill.when_to_use && <div style={{ fontSize: '12px', marginTop: '6px' }}>使用时机：{skill.when_to_use}</div>}
                                                    {(skill.granted_permissions && skill.granted_permissions.length > 0) && (
                                                        <div style={{ fontSize: '12px', marginTop: '6px' }}>声明权限：{skill.granted_permissions.join(', ')}</div>
                                                    )}
                                                    {skill.model_override && <div style={{ fontSize: '12px', marginTop: '6px' }}>模型偏好：{skill.model_override}</div>}
                                                    <div style={{ fontSize: '12px', marginTop: '6px', opacity: 0.9 }}>
                                                        {skill.source_scope ? `来源: ${skill.source_scope}` : ''}
                                                        {skill.location ? ` · ${skill.location}` : ''}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}

                                    {msg.content && (
                                        <div className="message-content prose prose-sm max-w-none" style={{ marginTop: '8px', color: '#374151', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                                            {msg.content}
                                        </div>
                                    )}

                                    {/* Streaming Indicator */}
                                    {isStreaming && msg.id === activeAgentMsgIdRef.current && !msg.content && (!msg.toolCalls || msg.toolCalls.length === 0) && (
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#9ca3af', marginTop: '8px' }}>
                                            <Loader2 size={16} className="animate-spin" />
                                            <span style={{ fontSize: '13px' }}>思考中...</span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </React.Fragment>
                ))}
                <div ref={messagesEndRef} />
            </div>

            <div className="chat-input-container p-4 border-t border-gray-100 bg-white">
                <div className="chat-input-wrapper shadow-sm" style={{ display: 'flex', alignItems: 'center', background: '#fff', border: '1px solid #e5e7eb', borderRadius: '12px', padding: '8px 12px', transition: 'border-color 0.2s' }}>
                    <input
                        type="file"
                        ref={fileInputRef}
                        style={{ display: 'none' }}
                        onChange={handleFileUpload}
                        multiple
                    />
                    <button
                        className="upload-btn"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={uploading}
                        title="上传文件到工作区"
                        style={{
                            background: 'transparent',
                            border: 'none',
                            color: uploading ? '#9ca3af' : '#6b7280',
                            cursor: uploading ? 'not-allowed' : 'pointer',
                            padding: '6px',
                            borderRadius: '6px',
                            marginRight: '4px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                        }}
                        onMouseOver={(e) => !uploading && (e.currentTarget.style.color = '#1f2937')}
                        onMouseOut={(e) => !uploading && (e.currentTarget.style.color = '#6b7280')}
                    >
                        {uploading ? <Loader2 size={18} className="animate-spin" /> : <Paperclip size={18} />}
                    </button>
                    <input
                        className="chat-input flex-1"
                        placeholder="输入消息..."
                        value={inputValue}
                        onChange={(e) => setInputValue(e.target.value)}
                        onKeyDown={handleKeyDown}
                        style={{ border: 'none', outline: 'none', padding: '8px 4px', fontSize: '15px' }}
                    />
                    <button
                        onClick={handleSend}
                        disabled={!inputValue.trim()}
                        style={{
                            background: inputValue.trim() ? '#1f2937' : '#f3f4f6',
                            border: 'none',
                            color: inputValue.trim() ? '#fff' : '#d1d5db',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            cursor: inputValue.trim() ? 'pointer' : 'not-allowed',
                            padding: '8px',
                            borderRadius: '8px',
                            transition: 'all 0.2s'
                        }}>
                        <Send size={18} />
                    </button>
                </div>
            </div>
        </main>
    );
};

export default ChatArea;
