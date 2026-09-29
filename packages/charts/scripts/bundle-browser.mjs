#!/usr/bin/env node
/**
 * Bundles the compiled package into one browser script (global `DataAgentCharts`)
 * and exports its source as a string, so standalone dashboards can inline the
 * compiler. Exporting a module rather than shipping a loose file lets the
 * Runtime's own bundle carry it; nothing is resolved from disk at run time.
 */
import { build } from "esbuild";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");
const result = await build({
  entryPoints: [path.join(dist, "index.js")],
  bundle: true,
  format: "iife",
  globalName: "DataAgentCharts",
  platform: "browser",
  target: "es2020",
  minify: true,
  write: false,
  legalComments: "none",
});
// Keep a "</script" inside the bundle from closing the inline tag early.
const source = result.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
writeFileSync(path.join(dist, "browser-source.js"), `/** The browser bundle of @data-agent/charts, exposing the global DataAgentCharts. */\nexport const CHARTS_BROWSER_SOURCE = ${JSON.stringify(source)};\n`);
writeFileSync(path.join(dist, "browser-source.d.ts"), "/** The browser bundle of @data-agent/charts, exposing the global DataAgentCharts. */\nexport declare const CHARTS_BROWSER_SOURCE: string;\n");
console.log(`charts browser bundle: ${(source.length / 1024).toFixed(0)} KiB`);
