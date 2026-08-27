export interface AgentMessageLike {
    content: string;
    transientContent: string;
    reasoningContent: string;
    toolCallsById: Record<string, unknown>;
    widgetsById: Record<string, unknown>;
    skillActivations: unknown[];
    terminalReason: 'completed' | 'stopped' | 'error' | null;
    retryNotice?: string;
    statusNotice?: string;
}

const IMMEDIATE_FEEDBACK_TEXT = '收到，我正在分析请求并检索可用工具…';

export const visibleAgentContent = (message: AgentMessageLike) => {
    const normalizedContent = message.content.trimStart().startsWith(IMMEDIATE_FEEDBACK_TEXT)
        ? message.content.trimStart().slice(IMMEDIATE_FEEDBACK_TEXT.length).trimStart()
        : message.content;
    return normalizedContent || message.transientContent;
};

/**
 * An agent bubble is only empty when it has no user-visible or diagnostic
 * payload. In particular, tool-only turns must remain visible.
 */
export const isAgentMessageEmpty = (message: AgentMessageLike) => (
    visibleAgentContent(message).trim().length === 0 &&
    message.reasoningContent.trim().length === 0 &&
    Object.keys(message.toolCallsById).length === 0 &&
    Object.keys(message.widgetsById).length === 0 &&
    message.skillActivations.length === 0 &&
    message.terminalReason !== 'error' &&
    !message.retryNotice?.trim() &&
    !message.statusNotice?.trim()
);
