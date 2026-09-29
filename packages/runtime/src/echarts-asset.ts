import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

/** The ECharts build that standalone dashboards inline, so they render charts offline. */
const ECHARTS_ASSET = "echarts/dist/echarts.min.js";

/**
 * Locates the ECharts build that standalone dashboards inline, so they render charts offline.
 * Works both as native ESM and inside an esbuild CJS bundle where import.meta.url is defined away.
 */
export function resolveEchartsAssetPath(): string | undefined {
  try {
    const base = typeof import.meta.url === "string" ? import.meta.url : __filename;
    return createRequire(base).resolve(ECHARTS_ASSET);
  } catch {
    return undefined;
  }
}

const echartsSources = new Map<string, Promise<string>>();

export function readEchartsSource(assetPath: string): Promise<string> {
  let source = echartsSources.get(assetPath);
  if (!source) {
    // Keep a stray "</script" in the library from closing the inline tag early.
    source = readFile(assetPath, "utf8").then((text) => text.replace(/<\/script/gi, "<\\/script"));
    source.catch(() => echartsSources.delete(assetPath));
    echartsSources.set(assetPath, source);
  }
  return source;
}
