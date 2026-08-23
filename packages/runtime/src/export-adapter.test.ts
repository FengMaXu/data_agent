import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createExportQueryAdapter, ExportCapabilityError } from "./export-adapter.js";
import { WorkspaceStore } from "./workspace.js";

describe("Export query adapter", () => {
  it("rejects sessions without export and resource transfer capability", () => {
    const adapter = createExportQueryAdapter({ workspace: new WorkspaceStore(process.cwd()) });
    expect(() => adapter.assertCapability(undefined)).toThrow("EXPORT_NOT_SUPPORTED");
    expect(() => adapter.assertCapability({ export: true })).toThrow("EXPORT_NOT_SUPPORTED");
    adapter.assertCapability({ export: true, resourceTransfer: true });
  });

  it("validates media type, size, hash, and writes atomically into the workspace", async () => {
    const root = await mkdtemp(join(tmpdir(), "data-agent-export-"));
    const workspace = new WorkspaceStore(root);
    const adapter = createExportQueryAdapter({ workspace, maxBytes: 1024 });
    await expect(adapter.acceptResource({ uri: "sqlite://exports/x.txt", mimeType: "text/plain", blob: Buffer.from("x").toString("base64") })).rejects.toThrow("EXPORT_MEDIA_TYPE_REJECTED");
    await expect(adapter.acceptResource({ uri: "sqlite://exports/big.csv", mimeType: "text/csv", blob: Buffer.alloc(2048).toString("base64") })).rejects.toThrow("EXPORT_TOO_LARGE");

    const blob = Buffer.from("id,region\n1,north\n2,south\n", "utf8");
    const result = await adapter.acceptResource({ uri: "sqlite://exports/abc.csv", mimeType: "text/csv", blob: blob.toString("base64") }, "data/exports/abc.csv");
    expect(result.bytes).toBe(blob.byteLength);
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(await readFile(join(root, "data", "exports", "abc.csv"), "utf8")).toContain("north");
    await rm(root, { recursive: true, force: true });
  });
});
