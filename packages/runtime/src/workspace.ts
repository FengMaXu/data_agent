import { copyFile, mkdir, open, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { boundTextByLines, type BoundedReadResult, type LineRange } from "./bounded-read.js";

export interface WorkspaceArtifact { path: string; size: number; modifiedAt: number; kind: "file" }
export type WorkspaceStreamProducer = (write: (chunk: string | Uint8Array) => Promise<void>) => Promise<void>;

export class WorkspaceStore {
  readonly root: string;
  private readonly ownerUserId?: string;
  private readonly ownerSessionId?: string;
  constructor(root: string, ownership: { userId?: string; sessionId?: string } = {}) { this.root = path.resolve(root); this.ownerUserId = ownership.userId; this.ownerSessionId = ownership.sessionId; }
  assertAccess(context: { userId: string; sessionId?: string }): void { if (this.ownerUserId && context.userId !== this.ownerUserId) throw new Error("WORKSPACE_OWNER_MISMATCH"); if (this.ownerSessionId && context.sessionId !== this.ownerSessionId) throw new Error("WORKSPACE_SESSION_MISMATCH"); }
  private resolve(relativePath: string): string { const target = path.resolve(this.root, relativePath); if (target !== this.root && !target.startsWith(`${this.root}${path.sep}`)) throw new Error("WORKSPACE_PATH_ESCAPE"); return target; }
  async list(): Promise<string[]> { return readdir(this.root, { recursive: true }) as Promise<string[]>; }
  private async safeExisting(relativePath: string): Promise<string> { const target = await realpath(this.resolve(relativePath)); const root = await realpath(this.root); if (target !== root && !target.startsWith(`${root}${path.sep}`)) throw new Error("WORKSPACE_SYMLINK_ESCAPE"); return target; }
  async read(relativePath: string): Promise<string> { return (await this.readRange(relativePath)).content; }
  async readRange(relativePath: string, range: LineRange = {}): Promise<BoundedReadResult> {
    return boundTextByLines(await readFile(await this.safeExisting(relativePath), "utf8"), range);
  }
  async write(relativePath: string, content: string): Promise<void> { const target=this.resolve(relativePath); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, content, "utf8"); }
  async delete(relativePath: string): Promise<void> { await rm(await this.safeExisting(relativePath), { force: true, recursive: true }); }
  async upload(sourcePath: string, relativePath: string): Promise<WorkspaceArtifact> { const target=this.resolve(relativePath); await mkdir(path.dirname(target), { recursive: true }); await copyFile(sourcePath, target); return this.artifact(relativePath); }
  /** Write incrementally to a sibling temporary file, then atomically promote it. */
  async writeStream(relativePath: string, producer: WorkspaceStreamProducer, signal?: AbortSignal): Promise<void> {
    const target = this.resolve(relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    const temporary = `${target}.${randomUUID()}.tmp`;
    const handle = await open(temporary, "w");
    const throwIfAborted = () => {
      if (signal?.aborted) throw new Error("EXPORT_CANCELLED");
    };
    try {
      await producer(async (chunk) => {
        throwIfAborted();
        if (typeof chunk === "string") await handle.write(chunk);
        else await handle.write(chunk);
      });
      throwIfAborted();
      await handle.sync();
      await handle.close();
      await rename(temporary, target);
    } catch (error) {
      await handle.close().catch(() => undefined);
      await rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
  }
  async artifact(relativePath: string): Promise<WorkspaceArtifact> { const info=await stat(await this.safeExisting(relativePath)); return { path: relativePath, size: info.size, modifiedAt: info.mtimeMs, kind: "file" }; }
}
