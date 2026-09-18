#!/usr/bin/env node
/** Startup smoke test for the Fastify Web Host production command boundary. */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const root = process.cwd();
const toUrl = (value) => {
  let normalized = value.split(String.fromCharCode(92)).join("/");
  if (!normalized.startsWith("/")) normalized = `/${normalized}`;
  return new URL(`file://${normalized}`).href;
};
const { createDataAgentApplication } = await import(toUrl(path.join(root, "packages/runtime/dist/index.js")));
const { createRuntimeServer } = await import(toUrl(path.join(root, "apps/server/dist/index.js")));

const tempRoot = await mkdtemp(path.join(tmpdir(), "smoke-web-"));
const application = await createDataAgentApplication({
  dataRoot: tempRoot,
  host: "web",
  systemPrompt: "You are Data Agent.",
  resolveProfile: () => ({ provider: "openai", model: "smoke-model" }),
});
const app = await createRuntimeServer(application, { contextFactory: () => ({ userId: "smoke", host: "web" }) });
try {
  await app.ready();
  const response = await app.inject({
    method: "POST",
    url: "/api/runtime/command",
    payload: { protocolVersion: 1, requestId: "smoke", command: { type: "runtime.probe" } },
  });
  if (response.statusCode !== 200 || response.json().response?.type !== "runtime.probe.result") {
    throw new Error(`web host smoke FAILED: ${response.payload}`);
  }
  console.log("web host smoke OK");
} finally {
  await app.close();
  await application.close();
  await rm(tempRoot, { recursive: true, force: true });
}
