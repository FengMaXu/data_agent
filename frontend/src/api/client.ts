/**
 * Data Agent API Client
 * 用于连接后端 FastAPI 服务，处理 REST API 和 SSE 流
 */

const ENV_API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim();

function resolveApiBaseUrl(): string {
    if (ENV_API_BASE_URL) {
        return ENV_API_BASE_URL.replace(/\/$/, '');
    }

    if (typeof window !== 'undefined') {
        const injectedPort = window.__PORT__ ?? window.dataAgent?.backendPort;
        if (injectedPort) {
            return `http://127.0.0.1:${injectedPort}`;
        }

        const { hostname, port } = window.location;
        if (hostname === 'localhost' || hostname === '127.0.0.1') {
            if (port === '5173' || port === '5174') {
                return `http://${hostname}:8080`;
            }
            return `http://${hostname}:8080`;
        }
    }

    return '';
}

export const API_BASE_URL = resolveApiBaseUrl();

export interface AIConfig {
    default_model: string;
    openai_api_key?: string;
    anthropic_api_key?: string;
    openai_base_url?: string;
    mcp_server_script?: string;
    mysql_host?: string;
    mysql_port?: number;
    mysql_user?: string;
    mysql_database?: string;
}

export type LLMConfigUpdate = {
    provider?: 'openai' | 'anthropic';
    api_key?: string;
    openai_api_key?: string;
    anthropic_api_key?: string;
    base_url?: string;
    openai_base_url?: string;
    model?: string;
};

export type DBConfigUpdate = {
    host?: string;
    port?: number;
    user?: string;
    password?: string;
    database?: string;
};

export interface MCPMappingSummary {
    configured: boolean;
    count: number;
    safe_keys?: string[];
}

export interface MCPServerConfig {
    name: string;
    transport: 'stdio' | 'http' | 'sse';
    enabled: boolean;
    command?: string;
    script?: string;
    url?: string;
    headers?: MCPMappingSummary;
    env?: MCPMappingSummary;
    env_input?: string;
    headers_input?: string;
    description?: string;
    tool_prefix?: string;
    server_type?: string;
    tags?: string[];
}

export interface MCPConfig {
    servers: MCPServerConfig[];
}

export type MCPServerRequest = Omit<MCPServerConfig, 'headers' | 'env'> & {
    headers?: Record<string, string>;
    env?: Record<string, string>;
};

export interface MCPConfigRequest {
    servers: MCPServerRequest[];
}

export interface MCPServerStatus extends MCPServerConfig {
    connected?: boolean;
}

export interface MCPToolInfo {
    server: string;
    server_type: string;
    name: string;
    remote_name: string;
    description: string;
    parameters: any;
}

export interface MCPTestResult {
    success: boolean;
    message: string;
    tools?: MCPToolInfo[];
    server?: MCPServerConfig;
}

export interface SkillInfo {
    name: string;
    description: string;
    when_to_use?: string;
    location: string;
    skill_dir: string;
    source_scope: 'project' | 'global' | string;
    allowed_tools?: string[];
    model?: string | null;
}

export interface SkillListResponse {
    status: string;
    skills: SkillInfo[];
    total: number;
}

export interface WidgetSpec {
    widget_id: string;
    kind: 'metric_cards' | 'table' | 'chart' | 'steps' | 'rich_text' | 'echarts' | 'file_link';
    title: string;
    subtitle?: string;
    data?: any[];
    series?: any[];
    columns?: any[];
    actions?: any[];
    metadata?: Record<string, any>;
    raw_html?: string;
    raw_svg?: string;
    config?: Record<string, any>;
    drill_context?: {
        dimension: string;
        value: string | number;
        path: string[];
    };
    file_path?: string;
    download_url?: string;
    file_type?: string;
    status?: 'previewing' | 'ready' | 'error';
    error?: string;
    tool_call_id?: string;
    message_id?: string;
    session_id?: string;
}

export interface SessionSnapshotSkillActivation {
    name: string;
    description?: string;
    when_to_use?: string;
    location?: string;
    skill_dir?: string;
    source_scope?: string;
    granted_permissions?: string[];
    model_override?: string | null;
    ui_message?: string;
    source?: string;
    command_text?: string;
}

export type AgentProgressStage =
    | 'sent'
    | 'understanding'
    | 'selecting_tool'
    | 'executing_query'
    | 'generating_answer';

export type AgentTerminalReason = 'completed' | 'stopped' | 'error' | null;

export interface SessionSnapshotAgentToolCall {
    toolCallId: string;
    name: string;
    arguments: any;
    partialArguments?: string;
    result?: string;
    details?: any;
    isError?: boolean;
    widgetId?: string | null;
    status: 'calling' | 'running' | 'done' | 'error';
}


export interface SessionSnapshotMessage {
    id: string;
    role: 'user' | 'agent';
    content: string;
    messageId?: string;
    toolCallsById?: Record<string, SessionSnapshotAgentToolCall>;
    widgetsById?: Record<string, WidgetSpec>;
    skillActivations?: SessionSnapshotSkillActivation[];
    currentStage?: AgentProgressStage;
    visitedStages?: AgentProgressStage[];
    terminalReason?: AgentTerminalReason;
}

export interface ClarificationRequest {
    clarification_id: string;
    question: string;
    options: string[];
}
export type SSEEvent =
    | { type: 'message_start'; session_id?: string; message_id: string }
    | { type: 'progress'; session_id?: string; stage: Exclude<AgentProgressStage, 'sent'> }
    | { type: 'text_delta'; session_id?: string; message_id: string; content: string }
    | { type: 'tool_call'; session_id?: string; message_id: string; tool_call_id: string; widget_id?: string | null; name: string; arguments: any }
    | { type: 'widget_patch'; session_id?: string; message_id: string; tool_call_id: string; widget_id: string; tool_name: string; patch: Partial<WidgetSpec> }
    | { type: 'widget'; session_id?: string; message_id: string; tool_call_id: string; widget_id: string; tool_name: string; widget: WidgetSpec }
    | { type: 'widget_done'; session_id?: string; message_id: string; tool_call_id: string; widget_id: string }
    | { type: 'widget_remove'; session_id?: string; message_id: string; tool_call_id?: string; widget_id: string }
    | { type: 'widget_error'; session_id?: string; message_id: string; tool_call_id: string; widget_id: string; error: string }
    | { type: 'tool_result'; session_id?: string; message_id: string; tool_call_id: string; widget_id?: string | null; name: string; arguments: any; content: string; details?: any; is_error?: boolean }
    | { type: 'clarification_request'; session_id?: string; clarification_id: string; question: string; options: string[] }
    | { type: 'clarification_answered'; session_id?: string; clarification_id: string; answer: string }
    | { type: 'skill_activated'; session_id?: string; skill: SkillInfo & { source?: string; command_text?: string; granted_permissions?: string[]; model_override?: string | null; ui_message?: string } }
    | { type: 'workspace_updated'; session_id?: string; tool: string }
    | { type: 'error'; session_id?: string; error: string }
    | { type: 'done'; session_id?: string; run_id?: string; reason: 'completed' | 'stopped' | 'error' };

export async function clearSession(sessionId: string = 'default') {
    await fetch(`${API_BASE_URL}/agent/clear?session_id=${sessionId}`, { method: 'POST' });
}

export interface ChatStreamHandle {
    cancel: () => void;
    finished: Promise<void>;
}

export async function sendChatMessage(
    prompt: string,
    onEvent: (event: SSEEvent) => void,
    onError: (err: any) => void,
    onFinish: () => void,
    sessionId: string = 'default',
    attachedFiles: string[] = [],
): Promise<ChatStreamHandle> {
    const controller = new AbortController();

    const finished = (async () => {
        try {
            const response = await fetch(`${API_BASE_URL}/agent/chat`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ prompt, session_id: sessionId, attached_files: attachedFiles }),
                signal: controller.signal,
            });

            if (!response.ok) {
                let detail = `API error: ${response.status}`;
                try {
                    const payload = await response.json();
                    if (payload?.detail) {
                        detail = typeof payload.detail === 'string' ? payload.detail : JSON.stringify(payload.detail);
                    }
                } catch {
                    // ignore
                }
                throw new Error(detail);
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
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (!line.startsWith('data: ')) continue;
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

            onFinish();
        } catch (err) {
            if ((err as Error)?.name === 'AbortError') {
                onFinish();
                return;
            }
            console.error('Chat error:', err);
            onError(err);
            onFinish();
        }
    })();

    return {
        cancel: () => controller.abort(),
        finished,
    };
}

export async function answerClarification(
    clarificationId: string,
    answer: string,
    sessionId: string = 'default',
) {
    const response = await fetch(`${API_BASE_URL}/agent/clarification`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clarification_id: clarificationId, answer, session_id: sessionId }),
    });
    if (!response.ok) {
        let detail = 'Failed to submit clarification answer';
        try {
            const payload = await response.json();
            if (payload?.detail) {
                detail = typeof payload.detail === 'string' ? payload.detail : JSON.stringify(payload.detail);
            }
        } catch {
            // ignore
        }
        throw new Error(detail);
    }
    return response.json();
}

export async function stopAgent(sessionId: string = 'default') {
    const response = await fetch(`${API_BASE_URL}/agent/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId }),
    });
    if (!response.ok) {
        throw new Error('Failed to stop agent');
    }
    return response.json();
}

export async function steerAgent(prompt: string, sessionId: string = 'default') {
    const response = await fetch(`${API_BASE_URL}/agent/steer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, session_id: sessionId }),
    });
    if (!response.ok) {
        throw new Error('Failed to steer agent');
    }
    return response.json();
}


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

export async function testLLMConfig(data: LLMConfigUpdate): Promise<{ success: boolean; message: string; details?: any }> {
    const res = await fetch(`${API_BASE_URL}/settings/llm/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Failed to test LLM config');
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

export async function getMCPConfig(): Promise<MCPConfig> {
    const res = await fetch(`${API_BASE_URL}/mcp/config`);
    if (!res.ok) throw new Error('Failed to fetch MCP config');
    return res.json();
}

export async function saveMCPConfig(data: MCPConfigRequest) {
    const res = await fetch(`${API_BASE_URL}/mcp/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Failed to save MCP config');
    return res.json();
}

export async function getMCPServers(): Promise<{ status: string; servers: MCPServerStatus[] }> {
    const res = await fetch(`${API_BASE_URL}/mcp/servers`);
    if (!res.ok) throw new Error('Failed to fetch MCP servers');
    return res.json();
}

export async function getMCPTools(): Promise<{ status: string; tools: MCPToolInfo[] }> {
    const res = await fetch(`${API_BASE_URL}/mcp/tools`);
    if (!res.ok) throw new Error('Failed to fetch MCP tools');
    return res.json();
}

export async function testMCPServer(data: MCPServerRequest): Promise<MCPTestResult> {
    const res = await fetch(`${API_BASE_URL}/mcp/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Failed to test MCP server');
    return res.json();
}

export async function getSkills(): Promise<SkillListResponse> {
    const res = await fetch(`${API_BASE_URL}/agent/skills`);
    if (!res.ok) throw new Error('Failed to fetch skills');
    return res.json();
}

export interface WorkspaceFile {
    name: string;
    relative_path: string;
    size: number;
    modified_at: string;
}

export interface WorkspaceFilesResponse {
    files: WorkspaceFile[];
}

export async function getWorkspaceFiles(sessionId: string = ''): Promise<WorkspaceFilesResponse> {
    const url = sessionId
        ? `${API_BASE_URL}/workspace/files?session_id=${encodeURIComponent(sessionId)}`
        : `${API_BASE_URL}/workspace/files`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Failed to fetch workspace files');
    return res.json();
}

export function getWorkspaceFileDownloadUrl(relativePath: string): string {
    return `${API_BASE_URL}/workspace/files/download?path=${encodeURIComponent(relativePath)}`;
}

export async function uploadWorkspaceFile(file: File, sessionId: string = ''): Promise<void> {
    const formData = new FormData();
    formData.append('file', file);
    if (sessionId) {
        formData.append('session_id', sessionId);
    }

    const res = await fetch(`${API_BASE_URL}/workspace/upload`, {
        method: 'POST',
        body: formData,
    });
    if (!res.ok) throw new Error('Failed to upload file');
}

export async function deleteWorkspaceFile(relativePath: string): Promise<void> {
    const res = await fetch(`${API_BASE_URL}/workspace/files?path=${encodeURIComponent(relativePath)}`, {
        method: 'DELETE',
    });
    if (!res.ok) throw new Error('Failed to delete file');
}

export interface KnowledgeFile {
    name: string;
    path: string;
    size: number;
    modified_at: string;
    type: 'file' | 'directory';
}

export interface KnowledgeListResponse {
    status: string;
    files: KnowledgeFile[];
    total: number;
}

export interface KnowledgeContentResponse {
    status: string;
    content: string;
    path: string;
    name: string;
}

export async function getKnowledgeFiles(): Promise<KnowledgeListResponse> {
    const res = await fetch(`${API_BASE_URL}/knowledge/files`);
    if (!res.ok) throw new Error('Failed to fetch knowledge files');
    return res.json();
}

export async function getKnowledgeContent(path: string): Promise<KnowledgeContentResponse> {
    const res = await fetch(`${API_BASE_URL}/knowledge/content?path=${encodeURIComponent(path)}`);
    if (!res.ok) throw new Error('Failed to fetch knowledge content');
    return res.json();
}

export async function saveKnowledgeContent(path: string, content: string): Promise<{ status: string; message: string }> {
    const res = await fetch(`${API_BASE_URL}/knowledge/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, content }),
    });
    if (!res.ok) throw new Error('Failed to save knowledge content');
    return res.json();
}
