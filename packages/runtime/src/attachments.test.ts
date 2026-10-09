import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatPromptWithAttachments, splitPromptAttachments } from "./attachments.js";
import { transcriptMessagesFromSnapshot } from "./facets/transcript.js";
import { DataAgentRuntime } from "./protocol.js";
import { WorkspaceStore } from "./workspace.js";

const context = { userId: "local", host: "electron" as const, sessionId: "session-1" };

describe("prompt attachments", () => {
  it("round-trips the prompt and attached paths through the stored text", () => {
    const text = formatPromptWithAttachments("汇总这份销售表\n按区域", [
      { path: "sales (2026).csv", size: 12_600 },
      { path: "notes.txt", size: 300 },
    ]);
    expect(text).toContain("- sales (2026).csv (12.3 KB)");
    expect(text).toContain("- notes.txt (300 B)");
    expect(text).toContain("run_python");
    expect(splitPromptAttachments(text)).toEqual({ prompt: "汇总这份销售表\n按区域", attachments: ["sales (2026).csv", "notes.txt"] });
  });

  it("leaves a prompt without attachments, or one that only looks like the block, untouched", () => {
    expect(formatPromptWithAttachments("hello", [])).toBe("hello");
    expect(splitPromptAttachments("hello")).toEqual({ prompt: "hello", attachments: [] });
    const typed = "看看这个\n\n<attachments>\nanything\n- not a file line\n</attachments>";
    expect(splitPromptAttachments(typed)).toEqual({ prompt: typed, attachments: [] });
  });

  it("sends the model the prompt with references to files that exist in the Session workspace", async () => {
    const root = await mkdtemp(join(tmpdir(), "data-agent-attachments-"));
    try {
      await mkdir(join(root, "session-1"), { recursive: true });
      await writeFile(join(root, "session-1", "sales.csv"), "region,amount\nEast,1\n", "utf8");
      const prompts: string[] = [];
      const runtime = new DataAgentRuntime({
        workspace: new WorkspaceStore(root),
        agent: { prompt: async (text: string) => { prompts.push(text); return { operationId: "op-1" }; } },
      });
      const result = await runtime.dispatch({ protocolVersion: 1, requestId: "p", command: { type: "agent.prompt", prompt: "汇总", attachments: [{ path: "sales.csv" }, { path: "sales.csv" }] } }, context);
      expect(result.response).toEqual({ type: "agent.prompt.accepted", runId: "op-1" });
      expect(prompts).toHaveLength(1);
      expect(splitPromptAttachments(prompts[0])).toEqual({ prompt: "汇总", attachments: ["sales.csv"] });

      await expect(runtime.dispatch({ protocolVersion: 1, requestId: "missing", command: { type: "agent.prompt", prompt: "汇总", attachments: [{ path: "absent.csv" }] } }, context))
        .rejects.toMatchObject({ code: "INVALID_COMMAND", message: "ATTACHMENT_NOT_FOUND: absent.csv" });
      await expect(runtime.dispatch({ protocolVersion: 1, requestId: "escape", command: { type: "agent.prompt", prompt: "汇总", attachments: [{ path: "../session-2/x.csv" }] } }, context))
        .rejects.toMatchObject({ code: "INVALID_COMMAND" });
      await expect(runtime.dispatch({ protocolVersion: 1, requestId: "no-session", command: { type: "agent.prompt", prompt: "汇总", attachments: [{ path: "sales.csv" }] } }, { userId: "local", host: "electron" }))
        .rejects.toMatchObject({ code: "INVALID_CONTEXT" });
      expect(prompts).toHaveLength(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("shows the user message as typed, with its attachments listed separately", () => {
    const stored = formatPromptWithAttachments("汇总", [{ path: "sales.csv", size: 2048 }]);
    const messages = transcriptMessagesFromSnapshot({ transcript: [{ type: "message", id: "u1", seq: 1, timestamp: 1, message: { role: "user", content: stored } }] } as never);
    expect(messages).toEqual([{ id: "u1", role: "user", content: "汇总", timestamp: expect.any(Number), attachments: ["sales.csv"] }]);
  });
});
