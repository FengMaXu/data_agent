import { Worker } from "node:worker_threads";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { existsSync } from "node:fs";

type Pending = { resolve: (value: any) => void; reject: (error: Error) => void };
export class MetadataStore {
  private readonly worker: Worker;
  private next = 1;
  private pending = new Map<number, Pending>();
  constructor(dbPath: string) {
    const sourceDir = path.dirname(fileURLToPath(import.meta.url));
    const workerPath = path.join(sourceDir, "metadata-worker.js");
    const builtWorkerPath = path.resolve(sourceDir, "../dist/metadata-worker.js");
    this.worker = new Worker(existsSync(workerPath) ? workerPath : builtWorkerPath, { workerData: { path: path.resolve(dbPath) } });
    this.worker.on("message", (message: { id: number; ok: boolean; result?: unknown; error?: string }) => { const p=this.pending.get(message.id); if(!p)return; this.pending.delete(message.id); message.ok?p.resolve(message.result):p.reject(new Error(message.error)); });
    this.worker.on("error", error => { for(const p of this.pending.values())p.reject(error); this.pending.clear(); });
  }
  call(op: string, userId: string, values: Record<string, unknown> = {}): Promise<any> { const id=this.next++; return new Promise((resolve,reject)=>{this.pending.set(id,{resolve,reject});this.worker.postMessage({id,op,userId,...values});}); }
  async knowledgeCachePut(cachePath: string, revision: number, payload: unknown): Promise<void> { await this.call("knowledge.cache_put", "system", { cachePath, revision, payload: JSON.stringify(payload) }); }
  async knowledgeCacheGet(cachePath: string, revision: number): Promise<unknown> { return this.call("knowledge.cache_get", "system", { cachePath, revision }); }
  async knowledgeCacheClear(): Promise<void> { await this.call("knowledge.cache_clear", "system"); }
  async pendingOutbox(): Promise<any[]> { return this.call("outbox.list", "system"); }
  async close(): Promise<void> { await this.worker.terminate(); }
  static createId(): string { return randomUUID(); }
}
