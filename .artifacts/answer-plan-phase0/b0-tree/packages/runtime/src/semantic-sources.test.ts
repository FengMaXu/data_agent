import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DataAgentRuntime } from "./index.js";

const ctx = { userId: "local", host: "electron" as const };

describe("semantic sources from project dir", () => {
  it("lists and reads YAML sources from the semantic project directory", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "semantic-"));
    await mkdir(path.join(dir, "business-semantic", "conn-a"), { recursive: true });
    await writeFile(path.join(dir, "business-semantic", "conn-a", "orders.yaml"), "title: Orders\n");
    const runtime = new DataAgentRuntime({ semanticProjectDir: dir } as any);
    const list = await runtime.dispatch({ protocolVersion: 1, requestId: "r1", command: { type: "semantic.sources.list" } }, ctx);
    expect(list.response).toMatchObject({ type: "semantic.sources.result" });
    expect(list.response.sources).toHaveLength(1);
    expect(list.response.sources[0]).toMatchObject({ connectionId: "conn-a", sourceName: "orders" });
    const detail = await runtime.dispatch({ protocolVersion: 1, requestId: "r2", command: { type: "semantic.sources.get", connectionId: "conn-a", sourceName: "orders" } }, ctx);
    expect(detail.response.source.definition).toMatchObject({ rawYaml: "title: Orders\n" });
  });
});
