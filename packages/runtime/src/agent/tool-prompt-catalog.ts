export interface ToolPromptCatalogDefinition {
  readonly tool: { readonly name: string };
  readonly promptSnippet: string;
  readonly promptGuidelines: readonly string[];
}

interface CatalogEntry {
  readonly name: string;
  readonly promptSnippet: string;
  readonly promptGuidelines: readonly string[];
}

function compareNames(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertDefinition(definition: ToolPromptCatalogDefinition): void {
  const name = definition.tool?.name;
  if (typeof name !== "string" || !name.trim() || name !== name.trim()) throw new Error("TOOL_PROMPT_TOOL_NAME_INVALID");
  if (typeof definition.promptSnippet !== "string" || !definition.promptSnippet.trim() || /[\r\n]/u.test(definition.promptSnippet)) {
    throw new Error(`TOOL_PROMPT_SNIPPET_INVALID:${name}`);
  }
  if (!Array.isArray(definition.promptGuidelines)) throw new Error(`TOOL_PROMPT_GUIDELINES_INVALID:${name}`);
  for (const guideline of definition.promptGuidelines) {
    if (typeof guideline !== "string" || !guideline.trim() || /[\r\n]/u.test(guideline)) {
      throw new Error(`TOOL_PROMPT_GUIDELINE_INVALID:${name}`);
    }
  }
}

function catalogEntry(definition: ToolPromptCatalogDefinition): CatalogEntry {
  const name = definition.tool.name;
  const guidelines = [...new Set(definition.promptGuidelines.map((guideline) => guideline.trim()))];
  return Object.freeze({
    name,
    promptSnippet: definition.promptSnippet.trim(),
    promptGuidelines: Object.freeze(guidelines),
  });
}

/**
 * Deterministic, read-only prompt directory for one trusted tool-definition
 * set. It only describes names selected for the current request; it never
 * changes authorization or executes a tool.
 */
export class ToolPromptCatalog {
  private readonly entries: ReadonlyMap<string, CatalogEntry>;
  private readonly orderedNames: readonly string[];

  constructor(definitions: readonly ToolPromptCatalogDefinition[]) {
    const entries = new Map<string, CatalogEntry>();
    for (const definition of definitions) {
      assertDefinition(definition);
      const name = definition.tool.name;
      if (entries.has(name)) throw new Error(`TOOL_PROMPT_DUPLICATE_DEFINITION:${name}`);
      entries.set(name, catalogEntry(definition));
    }
    this.entries = entries;
    this.orderedNames = Object.freeze([...entries.keys()].sort(compareNames));
  }

  /** Render only the exact tool names present in one model request. */
  render(activeToolNames: readonly string[]): string {
    const names = [...activeToolNames];
    const seen = new Set<string>();
    for (const name of names) {
      if (seen.has(name)) throw new Error(`TOOL_PROMPT_DUPLICATE_ACTIVE_TOOL:${name}`);
      seen.add(name);
      if (!this.entries.has(name)) throw new Error(`TOOL_PROMPT_UNKNOWN_ACTIVE_TOOL:${name}`);
    }
    if (names.length === 0) return "";

    const selected = this.orderedNames.filter((name) => seen.has(name));
    const summaries = selected.map((name) => {
      const entry = this.entries.get(name)!;
      return `- \`${entry.name}\`：${entry.promptSnippet}`;
    });
    const guidelines = selected.flatMap((name) => {
      const entry = this.entries.get(name)!;
      return entry.promptGuidelines.map((guideline) => `- \`${entry.name}\`：${guideline}`);
    });
    return [
      "## 当前可用工具",
      ...summaries,
      ...(guidelines.length > 0 ? ["", "## 工具使用守则", ...guidelines] : []),
    ].join("\n");
  }
}

