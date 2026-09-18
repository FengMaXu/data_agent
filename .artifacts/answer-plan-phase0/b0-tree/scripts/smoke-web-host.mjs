#!/usr/bin/env node
/**
 * Startup smoke test for the Fastify Web Host: boots the server with a temp
 * profile and verifies the versioned command endpoint responds.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require_ = createRequire(import.meta.url);
const root = process.cwd();
const toUrl = (p) => { let u = p.split(String.fromCharCode(92)).join("/"); if (!u.startsWith("/")) u = "/" + u; return new URL("file://" + u).href; };
const { DataAgentRuntime, MetadataStore, PiJsonlSessionStore } = await import(toUrl(path.join(root, "packages/runtime/dist/index.js")));
const { createRuntimeServer } = await import(toUrl(path.join(root, "apps/server/dist/index.js")));

const root_ = await mkdtemp(path.join(tmpdir(), "smoke-web-"));
const metadata = new MetadataStore(path.join(root_, "meta.db"));
const runtime = new DataAgentRuntime({ metadata, sessions: new PiJsonlSessionStore(path.join(root_, "sessions")) });
const app = await createRuntimeServer(runtime);
await app.ready();
const res = await app.inject({ method: "POST", url: "/api/runtime/command", payload: { protocolVersion: 1, requestId: "smoke", command: { type: "runtime.probe" } } });
if (res.statusCode !== 200 || res.json().response?.type !== "runtime.probe.result") {
  console.error("web host smoke FAILED", res.payload);
  process.exit(1);
}
await app.close();
await rm(root_, { recursive: true, force: true });
console.log("web host smoke OK");
