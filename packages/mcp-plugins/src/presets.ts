/** How to reach one MCP server process or endpoint. */
export type McpConnectionSpec =
  | { readonly id: string; readonly transport: "stdio"; readonly command: string; readonly args: readonly string[]; readonly env: Readonly<Record<string, string>> }
  | { readonly id: string; readonly transport: "streamable-http" | "sse"; readonly url: string; readonly headers: Readonly<Record<string, string>> };

export interface McpPresetField {
  readonly key: string;
  readonly label: string;
  readonly kind: "text" | "secret" | "choices";
  readonly required: boolean;
  readonly placeholder?: string;
  readonly help?: string;
  readonly choices?: readonly { readonly value: string; readonly label: string }[];
  /** Used when the user has not chosen; only for choices. */
  readonly defaultValue?: readonly string[];
}

export type McpPresetValues = Readonly<Record<string, string | readonly string[]>>;

/**
 * A plugin yourdb ships ready to configure. The user supplies the fields
 * (keys, paths); the preset owns where and how to connect.
 */
export interface McpPreset {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly fields: readonly McpPresetField[];
  /** The connections for these values; one plugin may reach several servers. */
  connections(values: McpPresetValues): readonly McpConnectionSpec[];
}

const text = (values: McpPresetValues, key: string): string => {
  const value = values[key];
  return typeof value === "string" ? value.trim() : "";
};

const list = (values: McpPresetValues, key: string, fallback: readonly string[]): readonly string[] => {
  const value = values[key];
  return Array.isArray(value) ? value : fallback;
};

/** 企查查智能体数据平台 (agent.qcc.com/guide): one Streamable HTTP server per data group, Bearer API key. */
const QCC_GROUPS = [
  { value: "company", label: "企业信息（工商、股东、对外投资）" },
  { value: "risk", label: "风险信息（失信、被执行、裁判文书）" },
  { value: "operation", label: "经营信息（招投标、资质、税务）" },
  { value: "ipr", label: "知识产权（专利、商标、著作权）" },
  { value: "executive", label: "董监高信息" },
  { value: "history", label: "历史工商信息（需企业实名认证）" },
  { value: "tender", label: "招标查查·标讯" },
] as const;
const DEFAULT_QCC_GROUPS = ["company", "risk", "operation", "ipr"];

export const QCC_PRESET: McpPreset = {
  id: "qcc",
  title: "企查查",
  description: "查询企业工商、风险、经营与知识产权信息，用于补充数据库中的企业名单。需要企查查智能体数据平台的 API Key。",
  fields: [
    { key: "apiKey", label: "API Key", kind: "secret", required: true, placeholder: "在 agent.qcc.com 个人中心获取", help: "企查查按调用计费，费用由该 Key 所属账户承担。" },
    { key: "groups", label: "数据分组", kind: "choices", required: true, choices: QCC_GROUPS, defaultValue: DEFAULT_QCC_GROUPS },
  ],
  connections(values) {
    const apiKey = text(values, "apiKey");
    const known = new Set<string>(QCC_GROUPS.map((group) => group.value));
    return list(values, "groups", DEFAULT_QCC_GROUPS).filter((group) => known.has(group)).map((group) => ({
      id: `qcc_${group}`,
      transport: "streamable-http" as const,
      url: `https://agent.qcc.com/mcp/${group}/stream`,
      headers: { Authorization: `Bearer ${apiKey}` },
    }));
  },
};

/** KTX (`ktx mcp stdio`, ktx/packages/cli): the local semantic layer and wiki of an existing KTX project. */
export const KTX_PRESET: McpPreset = {
  id: "ktx",
  title: "KTX",
  description: "接入已有 KTX 项目的语义层、指标与知识库。需要先在本机用 ktx setup 建好项目并完成导入，且本机已安装 Node.js。",
  fields: [
    { key: "projectDir", label: "KTX 项目目录", kind: "text", required: true, placeholder: "D:\\ktx-project", help: "包含 ktx.yaml 的目录。" },
    { key: "env", label: "环境变量（JSON，可选）", kind: "secret", required: false, placeholder: "{\"KTX_...\": \"...\"}", help: "KTX 需要的模型密钥等，只填写 KTX_ 开头或 KTX 文档要求的变量。" },
  ],
  connections(values) {
    const raw = text(values, "env");
    const env = raw ? parseStringMap(raw, "KTX 环境变量") : {};
    return [{
      id: "ktx",
      transport: "stdio" as const,
      command: "npx",
      args: ["-y", "@kaelio/ktx", "--project-dir", text(values, "projectDir"), "mcp", "stdio"],
      env,
    }];
  },
};

export const DEFAULT_MCP_PRESETS: readonly McpPreset[] = [QCC_PRESET, KTX_PRESET];

/** A JSON object of strings, as env and headers are written in the settings page. */
export function parseStringMap(raw: string, label: string): Record<string, string> {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error(`MCP_CONFIG_INVALID: ${label} 不是合法的 JSON`); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || Object.values(parsed).some((value) => typeof value !== "string")) {
    throw new Error(`MCP_CONFIG_INVALID: ${label} 必须是字符串键值对`);
  }
  return parsed as Record<string, string>;
}
