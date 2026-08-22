import { Worker } from "node:worker_threads";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";

type Pending = { resolve: (value: any) => void; reject: (error: Error) => void };
export class MetadataStore {
  private readonly worker: Worker;
  private next = 1;
  private pending = new Map<number, Pending>();
  constructor(dbPath: string) {
    this.worker = new Worker(fileURLToPath(new URL("./metadata-worker.js", import.meta.url)), { workerData: { path: path.resolve(dbPath) } });
    this.worker.on("message", (message: { id: number; ok: boolean; result?: unknown; error?: string }) => { const p=this.pending.get(message.id); if(!p)return; this.pending.delete(message.id); message.ok?p.resolve(message.result):p.reject(new Error(message.error)); });
    this.worker.on("error", error => { for(const p of this.pending.values())p.reject(error); this.pending.clear(); });
  }
  call(op: string, userId: string, values: Record<string, unknown> = {}): Promise<any> { const id=this.next++; return new Promise((resolve,reject)=>{this.pending.set(id,{resolve,reject});this.worker.postMessage({id,op,userId,...values});}); }
  async close(): Promise<void> { await this.worker.terminate(); }
  static createId(): string { return randomUUID(); }
}
