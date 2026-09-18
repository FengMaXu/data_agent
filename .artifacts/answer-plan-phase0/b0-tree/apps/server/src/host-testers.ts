/**
 * Host-injected tester ports shared by the Web Host.
 * Database probes are routed through the MySQL MCP child process; this module
 * never imports a database driver or opens a business-database connection.
 */
import { createMcpQueryExecutor, type McpQueryExecutorOptions } from "./mcp-query-executor.js";

export interface ProbeResult { success: boolean; message: string; details?: unknown }

function mysqlMcpEnv(connection: Record<string, unknown>, baseEnv: Record<string, string> = {}): Record<string, string> {
  const env = { ...baseEnv };
  for (const [key, envName] of [["host", "DATA_AGENT_MYSQL_HOST"], ["port", "DATA_AGENT_MYSQL_PORT"], ["user", "DATA_AGENT_MYSQL_USER"], ["password", "DATA_AGENT_MYSQL_PASSWORD"], ["database", "DATA_AGENT_MYSQL_DATABASE"]] as const) {
    if (connection[key] !== undefined && connection[key] !== null) env[envName] = String(connection[key]);
  }
  return env;
}

export async function testMySqlConnection(
  connection: Record<string, unknown>,
  mcp: McpQueryExecutorOptions,
): Promise<ProbeResult> {
  const host = String(connection.host ?? "127.0.0.1");
  const port = Number(connection.port ?? 3306);
  const database = connection.database ? String(connection.database) : undefined;
  const executor = createMcpQueryExecutor({ ...mcp, env: mysqlMcpEnv(connection, mcp.env) });
  try {
    await executor.run("SELECT 1 AS connection_ok", 1);
    return { success: true, message: `MySQL 连接成功（${host}:${port}${database ? `/ ${database}` : ""}）` };
  } catch (error) {
    return { success: false, message: `MySQL 连接失败: ${error instanceof Error ? error.message : String(error)}` };
  } finally {
    await executor.close().catch(() => undefined);
  }
}

export async function testLlmProfile(profile: Record<string, unknown>): Promise<ProbeResult> {
  const provider = String(profile.provider ?? "openai");
  const apiKey = String(profile.api_key ?? profile.openai_api_key ?? profile.anthropic_api_key ?? "").trim();
  const model = String(profile.model ?? (provider === "anthropic" ? "claude-sonnet-4-20250514" : "gpt-4o-mini"));
  if (!apiKey) return { success: false, message: "缺少 API Key" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    if (provider === "anthropic") {
      const baseUrl = String(profile.base_url ?? "https://api.anthropic.com").replace(/\/$/, "");
      const response = await fetch(`${baseUrl}/v1/messages`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: "user", content: "ping" }] }),
        signal: controller.signal,
      });
      if (response.ok) return { success: true, message: `Anthropic 连接成功（${model}）` };
      const text = await response.text().catch(() => "");
      return { success: false, message: `Anthropic 校验失败 (HTTP ${response.status})`, details: text.slice(0, 300) };
    }
    const baseUrl = String(profile.base_url ?? profile.openai_base_url ?? "https://api.openai.com/v1").replace(/\/$/, "");
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: "user", content: "ping" }] }),
      signal: controller.signal,
    });
    if (response.ok) return { success: true, message: `OpenAI 兼容接口连接成功（${model}）` };
    const text = await response.text().catch(() => "");
    return { success: false, message: `OpenAI 兼容接口校验失败 (HTTP ${response.status})`, details: text.slice(0, 300) };
  } catch (error) {
    const reason = error instanceof Error ? (error.name === "AbortError" ? "请求超时（20s）" : error.message) : String(error);
    return { success: false, message: `模型服务连接失败: ${reason}` };
  } finally {
    clearTimeout(timer);
  }
}

export function createHostTesters(options: { dbMcp: McpQueryExecutorOptions }) {
  return {
    dbTester: { test: (connection: Record<string, unknown>) => testMySqlConnection(connection, options.dbMcp) },
    llmTester: { test: testLlmProfile },
  };
}
