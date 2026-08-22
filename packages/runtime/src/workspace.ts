import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export class WorkspaceStore {
  readonly root: string;
  constructor(root: string) { this.root = path.resolve(root); }
  private resolve(relativePath: string): string { const target = path.resolve(this.root, relativePath); if (target !== this.root && !target.startsWith(`${this.root}${path.sep}`)) throw new Error("WORKSPACE_PATH_ESCAPE"); return target; }
  async list(): Promise<string[]> { return readdir(this.root, { recursive: true }) as Promise<string[]>; }
  async read(relativePath: string): Promise<string> { return readFile(this.resolve(relativePath), "utf8"); }
  async write(relativePath: string, content: string): Promise<void> { const target=this.resolve(relativePath); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, content, "utf8"); }
  async delete(relativePath: string): Promise<void> { await rm(this.resolve(relativePath), { force: true, recursive: true }); }
}
