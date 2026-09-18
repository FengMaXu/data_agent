import { createMcpQueryExecutor } from "../apps/server/dist/mcp-query-executor.js";
import { DataAgentSessionApplication, KnowledgeIndex, WorkspaceStore } from "../packages/runtime/dist/protocol.js";
import path from "node:path";
import process from "node:process";

const databasePath = "C:/data-agent-eval/Spider2/spider2-lite/resource/databases/California_Traffic_Collision/California_Traffic_Collision.sqlite";
const executor = createMcpQueryExecutor({
  command: process.execPath,
  args: [path.join(process.cwd(), "apps", "server", "dist", "reference-sqlite-mcp.js"), databasePath],
  dialect: "sqlite",
});

const profile = {
  provider: "openai",
  model: "deepseek-v4.1-flash-expires-on-0910",
  apiKey: "sk-1a465f0240254a02a8077da495ea0bbb",
  baseUrl: "https://api.deepseek.com",
  apiFormat: "chat",
  reasoning: true,
  maxTokens: 102400,
  thinkingLevel: "max",
  thinkingLevelMap: { max: "max" }
};

const app = new DataAgentSessionApplication({
  sessionRoot: "./.tmp-test-transcripts",
  workspace: new WorkspaceStore("./.tmp-test-workspace"),
  queryExecutor: executor,
  profile,
  systemPrompt: "You are Data Agent.",
  createMissingSessions: true,
});

const adapter = app.createAgentAdapter({ userId: "evaluation", host: "web", sessionId: "test-session-1" });

adapter.subscribe((event) => {
  console.log("EVENT:", event.type, event.envelope?.event?.type);
});

console.log("Calling prompt...");
const accepted = await adapter.prompt("How many rows are in the collision table?");
console.log("Accepted:", accepted);

for (let i = 0; i < 20; i++) {
  const open = await adapter.getOpenOperations();
  console.log(`Poll ${i}: open operations =`, open);
  await new Promise((r) => setTimeout(r, 500));
}

await app.close();
await executor.close();
