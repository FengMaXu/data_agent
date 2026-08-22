import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export interface WorkspaceArtifact { path: string; size: number; modifiedAt: number; kind: "file" }

export class WorkspaceStore {
  readonly root: string;
  private readonly ownerUserId?: string;
  private readonly ownerSessionId?: string;
  constructor(root: string, ownership: { userId?: string; sessionId?: string } = {}) { this.root = path.resolve(root); this.ownerUserId = ownership.userId; this.ownerSessionId = ownership.sessionId; }
  assertAccess(context: { userId: string; sessionId?: string }): void { if (this.ownerUserId && context.userId !== this.ownerUserId) throw new Error("WORKSPACE_OWNER_MISMATCH"); if (this.ownerSessionId && context.sessionId !== this.ownerSessionId) throw new Error("WORKSPACE_SESSION_MISMATCH"); }
  private resolve(relativePath: string): string { const target = path.resolve(this.root, relativePath); if (target !== this.root && !target.startsWith(`${this.root}${path.sep}`)) throw new Error("WORKSPACE_PATH_ESCAPE"); return target; }
  async list(): Promise<string[]> { return readdir(this.root, { recursive: true }) as Promise<string[]>; }
  async read(relativePath: string): Promise<string> { return readFile(this.resolve(relativePath), "utf8"); }
  async write(relativePath: string, content: string): Promise<void> { const target=this.resolve(relativePath); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, content, "utf8"); }
  async delete(relativePath: string): Promise<void> { await rm(this.resolve(relativePath), { force: true, recursive: true }); }
  async upload(sourcePath: string, relativePath: string): Promise<WorkspaceArtifact> { const target=this.resolve(relativePath); await mkdir(path.dirname(target), { recursive: true }); await copyFile(sourcePath, target); return this.artifact(relativePath); }
  async artifact(relativePath: string): Promise<WorkspaceArtifact> { const info=await stat(this.resolve(relativePath)); return { path: relativePath, size: info.size, modifiedAt: info.mtimeMs, kind: "file" }; }
}
