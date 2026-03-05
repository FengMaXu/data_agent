/**
 * Data Agent API Client
 * 用于连接后端 FastAPI 服务，处理 REST API 和 SSE 流
 */

export const API_BASE_URL = 'http://127.0.0.1:8000';

export interface AIConfig {
    default_model: string;
    openai_api_key?: string;
    openai_base_url?: string;
    mcp_server_script?: string;
    mysql_host?: string;
    mysql_port?: number;
    mysql_user?: string;
    mysql_database?: string;
}

export type LLMConfigUpdate = {
    api_key?: string;
    base_url?: string;
    model?: string;
};

export type DBConfigUpdate = {
    host?: string;
    port?: number;
    user?: string;
    password?: string;
    database?: string;
};

// ==========================================
// Agent 聊天 API (SSE)
// ==========================================

export type SSEEvent =
    | { type: 'text_delta'; content: string }
    | { type: 'tool_call'; name: string; arguments: any }
    | { type: 'tool_result'; name: string; content: string }
    | { type: 'error'; error: string }
    | { type: 'done' };

/**
 * 发送聊天消息并接收流式响应
 * @param prompt 用户输入
 * @param onEvent 接收到 SSE 事件的回调
 * @param onError 错误回调
 * @param onFinish 结束回调
 */
export async function sendChatMessage(
    prompt: string,
    onEvent: (event: SSEEvent) => void,
    onError: (err: any) => void,
    onFinish: () => void,
    sessionId: string = "default"
) {
    try {
        const response = await fetch(`${API_BASE_URL}/agent/chat`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ prompt, session_id: sessionId }),
        });

        if (!response.ok) {
            throw new Error(`API error: ${response.status}`);
        }

        if (!response.body) {
            throw new Error('No response body');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                break;
            }

            buffer += decoder.decode(value, { stream: true });

            // 处理 SSE 数据帧
            const lines = buffer.split('\n');
            buffer = lines.pop() || ''; // 保留最后一个不完整的行

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const dataStr = line.slice(6).trim();
                    if (!dataStr) continue;

                    try {
                        const event = JSON.parse(dataStr) as SSEEvent;
                        onEvent(event);
                        if (event.type === 'done') {
                            onFinish();
                            return;
                        }
                    } catch (e) {
                        console.error('Failed to parse SSE event:', dataStr, e);
                    }
                }
            }
        }

        onFinish();
    } catch (err) {
        console.error('Chat error:', err);
        onError(err);
        onFinish();
    }
}

export async function stopAgent() {
    await fetch(`${API_BASE_URL}/agent/stop`, { method: 'POST' });
}

export async function steerAgent(prompt: string, sessionId: string = "default") {
    await fetch(`${API_BASE_URL}/agent/steer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, session_id: sessionId }),
    });
}

export async function clearSession(sessionId: string = "default") {
    await fetch(`${API_BASE_URL}/agent/clear?session_id=${sessionId}`, { method: 'POST' });
}

// ==========================================
// 配置管理 API (REST)
// ==========================================

export async function getConfig(): Promise<AIConfig> {
    const res = await fetch(`${API_BASE_URL}/settings/config`);
    if (!res.ok) throw new Error('Failed to fetch config');
    return res.json();
}

export async function updateLLMConfig(data: LLMConfigUpdate) {
    const res = await fetch(`${API_BASE_URL}/settings/llm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Failed to update LLM config');
    return res.json();
}

export async function updateDBConfig(data: DBConfigUpdate) {
    const res = await fetch(`${API_BASE_URL}/settings/database`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    const result = await res.json();
    if (result.status === 'error') throw new Error(result.message);
    return result;
}

export async function testDBConnection(data: DBConfigUpdate) {
    const res = await fetch(`${API_BASE_URL}/settings/database/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    return res.json();
}
