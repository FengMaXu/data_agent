import { createHash } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { WorkspaceStore } from "./workspace.js";

export interface McpResourceDescriptor { uri: string; name?: string; mimeType?: string }
export interface McpCapability { export: boolean; resourceTransfer: boolean }

export class ExportCapabilityError extends Error {
  constructor(message: string) { super(message); this.name = "ExportCapabilityError"; }
}

export interface ExportQueryAdapterOptions {
  workspace: WorkspaceStore;
  maxBytes?: number;
}

/**
 * Dynamic export_query adapter: only valid when the connected MCP database
 * capability supports export and Resource transfer. Validates size, media type
 * and hash, then atomically writes the artifact into the Session workspace.
 */
export function createExportQueryAdapter(options: ExportQueryAdapterOptions) {
  const maxBytes = options.maxBytes ?? 256 * 1024 * 1024;
  return {
    assertCapability(capability: Partial<McpCapability> | undefined): void {
      if (!capability?.export || !capability?.resourceTransfer) {
        throw new ExportCapabilityError("EXPORT_NOT_SUPPORTED");
      }
    },
    async acceptResource(resource: { uri: string; mimeType?: string; blob: string }, relativePath?: string): Promise<{ path: string; sha256: string; bytes: number }> {
      if (!/\.csv$/i.test(new URL(resource.uri.replace(/^sqlite:\/\//, "http://")).pathname) && resource.mimeType !== "text/csv") {
        throw new ExportCapabilityError("EXPORT_MEDIA_TYPE_REJECTED");
      }
      const blob = Buffer.from(resource.blob, "base64");
      if (blob.byteLength > maxBytes) throw new ExportCapabilityError("EXPORT_TOO_LARGE");
      const sha256 = createHash("sha256").update(blob).digest("hex");
      const filename = relativePath ?? `data/exports/${path.basename(new URL(resource.uri.replace(/^sqlite:\/\//, "http://")).pathname)}`;
      const target = path.resolve(options.workspace.root, filename);
      if (!target.startsWith(`${options.workspace.root}${path.sep}`)) throw new ExportCapabilityError("WORKSPACE_PATH_ESCAPE");
      await mkdir(path.dirname(target), { recursive: true });
      const temp = `${target}.${randomUUID()}.tmp`;
      await writeFile(temp, blob);
      await rename(temp, target);
      return { path: path.relative(options.workspace.root, target).split(path.sep).join("/"), sha256, bytes: blob.byteLength };
    },
  };
}

function randomUUID(): string { return crypto.randomUUID(); }
