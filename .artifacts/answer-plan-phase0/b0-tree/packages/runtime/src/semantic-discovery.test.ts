import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DataAgentRuntime } from "./index.js";

/**
 * Semantic source auto-discovery (#29 UX): the runtime scans both canonical
 * business-semantic/<conn>/*.yaml and legacy KTX semantic-layer/<conn>/*.yaml
 * layouts so pre-existing projects appear without re-ingest.
 */
describe("semantic.sources.list dual-layout discovery", () => {
  const context = { userId: "local", host: "web" as const };

  it("discovers sources from both layouts without duplicates", async () => {
    const projectDir = await mkdtemp(path.join(tmpdir(), "semantic-scan-"));
    try {
      await mkdir(path.join(projectDir, "business-semantic", "default-mysql"), { recursive: true });
      await mkdir(path.join(projectDir, "semantic-layer", "default-mysql"), { recursive: true });
      await writeFile(path.join(projectDir, "business-semantic", "default-mysql", "rules.yaml"), "name: rules\n", "utf8");
      await writeFile(path.join(projectDir, "semantic-layer", "default-mysql", "business_sales_monthly.yaml"), "name: business_sales_monthly\n", "utf8");
      // Same model in both layouts: must be reported once.
      await writeFile(path.join(projectDir, "semantic-layer", "default-mysql", "rules.yaml"), "name: rules\n", "utf8");

      const runtime = new DataAgentRuntime({ semanticProjectDir: projectDir });
      const response = await runtime.dispatch({ protocolVersion: 1, requestId: "s1", command: { type: "semantic.sources.list" } }, context);
      const sources = (response.response as { sources: Array<{ connectionId: string; sourceName: string }> }).sources;
      expect(sources).toHaveLength(2);
      const names = sources.map((s) => s.sourceName).sort();
      expect(names).toEqual(["business_sales_monthly", "rules"]);

      // .get resolves across both layouts.
      const got = await runtime.dispatch(
        { protocolVersion: 1, requestId: "s2", command: { type: "semantic.sources.get", connectionId: "default-mysql", sourceName: "business_sales_monthly" } },
        context,
      );
      expect((got.response as { type: string }).type).toBe("semantic.source.result");
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  it("falls back to metadata-store sources when no project dir is configured", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "semantic-meta-"));
    try {
      const { MetadataStore } = await import("./index.js");
      const metadata = new MetadataStore(path.join(root, "meta.db"));
      await metadata.upsertSemanticSource("default-mysql", "manual_model", { name: "manual_model" });
      const runtime = new DataAgentRuntime({ metadata });
      const response = await runtime.dispatch({ protocolVersion: 1, requestId: "m1", command: { type: "semantic.sources.list" } }, context);
      const sources = (response.response as { sources: Array<{ sourceName: string }> }).sources;
      expect(sources.map((s) => s.sourceName)).toContain("manual_model");
      await metadata.close().catch(() => undefined);
    } finally {
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    }
  });
});
