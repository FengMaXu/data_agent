import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export interface KnowledgePlaceholder {
  readonly path: string;
  readonly knowledgeId: string;
  readonly name: string;
  readonly description: string;
  readonly usage?: "method" | "fact";
}

/**
 * Deployment-specific documents. A new knowledge root gets each one as a
 * frontmatter-only placeholder so its knowledgeId is fixed before anyone fills
 * it in; the Agent's catalog hides placeholders until they have content.
 * General method guides are built in and never copied here.
 */
export const KNOWLEDGE_PLACEHOLDERS: readonly KnowledgePlaceholder[] = [
  { path: "doc/business.md", knowledgeId: "business-definitions", name: "业务定义", description: "提供业务指标、枚举、阈值和已知业务约束；内容未明确时不得用通用经验补造业务定义。" },
  { path: "doc/db_schema.md", knowledgeId: "database-schema", name: "数据库结构", description: "提供表、列、类型及正式结构信息，用于物理映射；字段存在不自动证明业务含义。" },
  { path: "doc/query_patterns.md", knowledgeId: "query-patterns", name: "已验证查询模版", description: "提供可复用的查询结构和适用前提；只有当前口径与前提匹配时才能复用。" },
  { path: "doc/learning.md", knowledgeId: "learning-notes", name: "历史纠错与经验", description: "提供历史错误、方言陷阱和可复用经验；证据等级低于用户、业务定义和正式 Schema。", usage: "method" },
];

export function placeholderContent(placeholder: KnowledgePlaceholder): string {
  return [
    "---",
    `knowledgeId: ${placeholder.knowledgeId}`,
    `name: ${placeholder.name}`,
    `description: ${placeholder.description}`,
    ...(placeholder.usage ? [`usage: ${placeholder.usage}`] : []),
    "---",
    "",
  ].join("\n");
}

/** Write any missing placeholder into `root`; existing documents are never touched. Returns the paths written. */
export async function ensureKnowledgePlaceholders(root: string): Promise<string[]> {
  const written: string[] = [];
  for (const placeholder of KNOWLEDGE_PLACEHOLDERS) {
    const target = path.join(root, placeholder.path);
    if (existsSync(target)) continue;
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, placeholderContent(placeholder), { encoding: "utf8", flag: "wx" });
    written.push(placeholder.path);
  }
  return written;
}
