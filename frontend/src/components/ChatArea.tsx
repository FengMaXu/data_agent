import React, { useState, useRef, useEffect } from 'react';
import {
    Orbit,
    PenTool,
    Loader2,
    Send,
    Trash2
} from 'lucide-react';
import { sendChatMessage, steerAgent, clearSession, type SSEEvent } from '../api/client';
import type { ToolData } from './ToolPanel';

interface Message {
    id: string;
    role: 'user' | 'agent';
    content: string;
    toolCalls?: { name: string; arguments: any }[];
    toolResults?: { name: string; content: string }[];
}

interface ChatAreaProps {
    onUpdateTools?: (tools: ToolData[]) => void;
}

const ChatArea: React.FC<ChatAreaProps> = ({ onUpdateTools }) => {
    const [inputValue, setInputValue] = useState('');
    const [messages, setMessages] = useState<Message[]>([]);
    const [isStreaming, setIsStreaming] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    // Auto-scroll to bottom and update tools
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });

        if (onUpdateTools) {
            const allTools = messages.flatMap(msg => {
                if (!msg.toolCalls) return [];
                return msg.toolCalls.map(tc => {
                    const result = msg.toolResults?.find(tr => tr.name === tc.name)?.content;
                    return {
                        name: tc.name, // Extracting the actual tool name
                        args: tc.arguments,
                        result: result
                    };
                });
            });
            onUpdateTools(allTools);
        }
    }, [messages, onUpdateTools]);

    const handleSend = async () => {
        if (!inputValue.trim()) return;

        const currentSessionId = "default_session";
        const content = inputValue.trim();

        const userMsg: Message = {
            id: Date.now().toString(),
            role: 'user',
            content: content,
        };

        if (isStreaming) {
            // == Steering Flow ==
            setMessages(prev => [...prev, userMsg]);
            setInputValue('');
            try {
                await steerAgent(content, currentSessionId);
            } catch (err) {
                console.error("Failed to steer agent:", err);
            }
            return;
        }

        // == Normal Chat Flow ==
        const agentMsgId = (Date.now() + 1).toString();
        const initialAgentMsg: Message = {
            id: agentMsgId,
            role: 'agent',
            content: '',
            toolCalls: [],
            toolResults: []
        };

        setMessages(prev => [...prev, userMsg, initialAgentMsg]);
        setInputValue('');
        setIsStreaming(true);

        await sendChatMessage(
            content,
            (event: SSEEvent) => {
                setMessages(prev => prev.map(msg => {
                    if (msg.id !== agentMsgId) return msg;

                    // Update the active agent message
                    const updated = { ...msg };
                    if (event.type === 'text_delta') {
                        updated.content += event.content;
                    } else if (event.type === 'tool_call') {
                        updated.toolCalls = [
                            ...(updated.toolCalls || []),
                            { name: event.name, arguments: event.arguments }
                        ];
                        // Append to chat stream text
                        updated.content += `\n\n  🔧 调用工具: ${event.name}\n\n`;
                    } else if (event.type === 'tool_result') {
                        updated.toolResults = [
                            ...(updated.toolResults || []),
                            { name: event.name, content: event.content }
                        ];
                    } else if (event.type === 'error') {
                        updated.content += `\n\n**Error:** ${event.error}`;
                    }
                    return updated;
                }));
            },
            (err) => {
                console.error("Chat error:", err);
                setIsStreaming(false);
            },
            () => {
                setIsStreaming(false);
            },
            currentSessionId
        );
    };

    const handleClearSession = async () => {
        if (isStreaming) return;
        setMessages([]);
        if (onUpdateTools) onUpdateTools([]);
        try {
            await clearSession("default_session");
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

    return (
        <main className="chat-area">
            {/* Breadcrumb Header */}
            <header className="breadcrumb-header" style={{ justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Orbit size={16} className="breadcrumb-icon" />
                    <span style={{ color: '#1f2937', fontWeight: 600 }}>Agents</span>
                    <span className="breadcrumb-separator">/</span>
                    <span style={{ color: '#1f2937', fontWeight: 600 }}>Dash</span>
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

            <div className="chat-message-list scrollable-area flex flex-col gap-6 p-6">
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
                                            {isStreaming && msg.id === messages[messages.length - 1].id && (
                                                <Loader2 size={12} className="animate-spin ml-2" />
                                            )}
                                        </div>
                                    )}

                                    {/* Tool Results Details (expandable in future, now just showing latest) */}
                                    {msg.toolResults && msg.toolResults.length > 0 && (
                                        <div className="agent-loading-line truncate" style={{ fontSize: '13px', color: '#9ca3af', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
                                            <span style={{ color: '#10b981' }}>✓</span>
                                            <span>完成: {msg.toolResults[msg.toolResults.length - 1].name}</span>
                                        </div>
                                    )}

                                    {/* Markdown Content (Basic render) */}
                                    {msg.content && (
                                        <div className="message-content prose prose-sm max-w-none" style={{ marginTop: '8px', color: '#374151', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                                            {msg.content}
                                        </div>
                                    )}

                                    {/* Streaming Indicator */}
                                    {isStreaming && msg.id === messages[messages.length - 1].id && !msg.content && (!msg.toolCalls || msg.toolCalls.length === 0) && (
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
                <div className="chat-input-wrapper shadow-sm" style={{ display: 'flex', alignItems: 'center', background: '#fff', border: '1px solid #e5e7eb', borderRadius: '12px', padding: '8px 16px', transition: 'border-color 0.2s' }}>
                    <input
                        className="chat-input flex-1"
                        placeholder="输入消息..."
                        value={inputValue}
                        onChange={(e) => setInputValue(e.target.value)}
                        onKeyDown={handleKeyDown}
                        style={{ border: 'none', outline: 'none', padding: '8px 0', fontSize: '15px' }}
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
                        {isStreaming ? <Send size={18} /> : <Send size={18} />}
                    </button>
                </div>
            </div>
        </main>
    );
};

export default ChatArea;
