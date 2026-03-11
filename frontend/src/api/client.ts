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


// ==========================================
// Agent 聊天 API (SSE)
// ==========================================

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

export type SSEEvent =
    | { type: 'text_delta'; content: string }
    | { type: 'tool_call'; name: string; arguments: any }
    | { type: 'tool_result'; name: string; content: string }
    | { type: 'skill_activated'; skill: SkillInfo & { source?: string; command_text?: string; granted_permissions?: string[]; model_override?: string | null; ui_message?: string } }
    | { type: 'workspace_updated'; tool: string }
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

// ==========================================
// Workspace 文件管理 API
// ==========================================

export interface WorkspaceFile {
    name: string;
    relative_path: string;
    size: number;
    modified_at: string;
}

export interface WorkspaceFilesResponse {
    files: WorkspaceFile[];
}

export async function getWorkspaceFiles(sessionId: string = ""): Promise<WorkspaceFilesResponse> {
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

export async function uploadWorkspaceFile(file: File, sessionId: string = ""): Promise<void> {
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

// ==========================================
// Knowledge 文件管理 API
// ==========================================

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
