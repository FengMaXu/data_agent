import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { legacyRecordFromResult } from "../evaluation.mjs";
import { stableStringify } from "../record.mjs";

export async function convertLegacyCase(caseRoot, context = {}) {
  const result = JSON.parse(await readFile(path.join(caseRoot, "result.json"), "utf8"));
  const trace = JSON.parse(await readFile(path.join(caseRoot, "trace.json"), "utf8").catch(() => "{}"));
  return legacyRecordFromResult(result, trace, { ...context, caseId: result.instanceId });
}

export async function convertLegacyRun(runRoot, options = {}) {
  const casesRoot = path.join(runRoot, "cases");
  const entries = await readdir(casesRoot, { withFileTypes: true }).catch(() => []);
  const records = [];
  for (const entry of entries.filter((item) => item.isDirectory()).sort((left, right) => left.name.localeCompare(right.name))) {
    records.push(await convertLegacyCase(path.join(casesRoot, entry.name), { runId: options.runId ?? path.basename(runRoot), attemptId: "legacy" }));
  }
  const target = options.outputRoot ?? path.join(runRoot, "legacy-converted");
  await mkdir(target, { recursive: true });
  await writeFile(path.join(target, "episodes.jsonl"), `${records.map((record) => stableStringify(record)).join("\n")}\n`, "utf8");
  return { records, outputRoot: target, source: "legacy-result-trace" };
}
