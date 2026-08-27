import { JsonlSessionRepo, type Session } from "@earendil-works/pi-agent-core";
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/node";
import { mkdir } from "node:fs/promises";
import path from "node:path";

export class PiJsonlSessionStore {
  private readonly repo: JsonlSessionRepo;
  private readonly cwd: string;
  constructor(root: string) {
    this.cwd = path.resolve(root);
    this.repo = new JsonlSessionRepo({ fs: new NodeExecutionEnv({ cwd: this.cwd }), sessionsRoot: this.cwd });
  }
  async create(metadata: Record<string, unknown> = {}): Promise<Session<any>> {
    await mkdir(this.cwd, { recursive: true });
    return this.repo.create({ cwd: this.cwd, metadata });
  }
  async list(): Promise<any[]> { return this.repo.list({ cwd: this.cwd }); }
  async open(metadata: any): Promise<Session<any>> { return this.repo.open(metadata); }
  async openByAppSessionId(sessionId: string): Promise<Session<any>> {
    const metadata = (await this.list()).find((item) => item?.metadata?.sessionId === sessionId || item?.id === sessionId);
    if (!metadata) throw new Error(`SESSION_NOT_FOUND: ${sessionId}`);
    return this.open(metadata);
  }
}
