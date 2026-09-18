import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { assertNoLegacyTools, canonicalLocalTools } from "./tools-catalog.js";
import { loadSkillsFromDir } from "./skills.js";

describe("canonical tool surface", () => {
  it("exposes exactly the approved local tools with no legacy names", () => {
    const tools = canonicalLocalTools();
    const names = tools.map(t => t.name);
    expect(new Set(names).size).toBe(names.length);
    assertNoLegacyTools(names);
    for (const required of ["list_workspace", "read_file", "write_file", "run_python", "search_knowledge", "read_knowledge", "update_knowledge", "load_skill", "generate_dashboard", "show_widget", "query_database", "publish_query_result", "ask_user_clarification"]) {
      expect(names).toContain(required);
    }
    const exportAdapter = tools.find(t => t.name === "export_query")!;
    expect(exportAdapter.identity).toBe("mcp__database__export_query");
    expect(exportAdapter.origin).toBe("mcp-dynamic");
  });

  it("requires a Query Artifact in the canonical export schema", () => {
    const exportTool = canonicalLocalTools().find((tool) => tool.name === "export_query")!;
    const schema = exportTool.parameters as { required?: string[]; properties?: Record<string, unknown> };
    expect(schema.required).toContain("queryArtifactId");
    expect(schema.properties).toHaveProperty("queryArtifactId");
    expect(schema.properties).not.toHaveProperty("expected_rows");
    expect(schema.properties).not.toHaveProperty("expected_columns");
  });

  it("keeps Solver verification purposes out of the model-visible query surface", () => {
    const tools = canonicalLocalTools();
    const queryTool = tools.find((tool) => tool.name === "query_database")!;
    const schema = queryTool.parameters as { properties?: Record<string, any> };
    expect(schema.properties).not.toHaveProperty("purpose");
    expect(queryTool.description).not.toMatch(/reconciliation|verification/i);
    expect(tools.map((tool) => tool.name)).not.toContain("semantic_validate");
    expect(tools.map((tool) => tool.name)).not.toContain("sql_validate");
  });

  it("keeps SYSTEM.md tool references aligned with canonical or documented conditional tools", async () => {
    const prompt = await readFile(path.resolve(__dirname, "../../../.pi/SYSTEM.md"), "utf8");
    const registered = new Set(canonicalLocalTools().map((tool) => tool.name));
    const documentedConditional = new Set(["semantic_sl_discover", "semantic_sl_read_source", "semantic_sl_query"]);
    const operationValues = new Set(["append_learning", "write_draft", "update_schema"]);
    const toolVerb = /^(?:query|publish|export|read|write|search|update|load|generate|show|run|ask|build|edit|validate|execute|introspect|list|save|report|activate|check|semantic)/;
    const references = [...prompt.matchAll(/`([a-z][a-z0-9_]*)`/g)]
      .map((match) => match[1])
      .filter((name) => toolVerb.test(name) && !operationValues.has(name));
    const unresolved = [...new Set(references)].filter((name) => !registered.has(name) && !documentedConditional.has(name));
    expect(unresolved).toEqual([]);
    expect(prompt).toContain("### KTX 语义层");
    for (const name of documentedConditional) expect(prompt).toContain(`\`${name}\``);
  });

  it("keeps bundled Skills free of legacy tool names", async () => {
    const skillsDir = path.resolve(__dirname, "../../../.agents/skills");
    const { skills, diagnostics } = await loadSkillsFromDir(skillsDir);
    expect(diagnostics).toEqual([]);
    expect(skills.length).toBeGreaterThanOrEqual(3);
    assertNoLegacyTools(skills.flatMap(skill => skill.allowedTools));
    for (const skill of skills) {
      expect(skill.content).not.toMatch(/\b(execute_sql|export_sql_to_csv|write_workspace_file|read_workspace_file|build_dashboard|edit_dashboard|validate_dashboard_spec|build_semantic_dashboard|validate_semantic_dashboard_spec|activate_skill|tool_search|call_webhook)\b/);
      void readFile; // keep import used for parity with other suites
    }
  });
});
