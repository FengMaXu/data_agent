/** CLI entry: run as a stdio MCP server (used by hosts' query executors). */
import { startMysqlReferenceStdio } from "./index.js";

startMysqlReferenceStdio().catch((error) => {
  console.error("[mcp-mysql] failed to start:", error instanceof Error ? error.message : error);
  process.exit(1);
});
