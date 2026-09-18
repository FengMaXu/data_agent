import { JsonlSessionRepo, MemorySessionRepo, TODO_CONTEXT, withAbortSignal, type Session } from "@earendil-works/pi-agent-core";
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/node";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { ChildSessionRepository } from "./child-harness.js";

export class MemoryChildSessionRepository implements ChildSessionRepository {
  private readonly repo = new MemorySessionRepo();
  private readonly sessions = new Map<string, Session<any>>();

  async create(input: { readonly id: string; readonly parentSessionId: string; readonly signal?: AbortSignal }): Promise<Session<any>> {
    const session = await this.repo.create({ id: input.id, parentSessionId: input.parentSessionId }, input.signal ? withAbortSignal(input.signal, TODO_CONTEXT) : TODO_CONTEXT);
    this.sessions.set(input.id, session);
    return session;
  }

  async open(id: string, signal?: AbortSignal): Promise<Session<any> | undefined> {
    if (signal?.aborted) throw new Error("SUBAGENT_SESSION_OPEN_CANCELLED");
    return this.sessions.get(id);
  }

  async removeOrphans(knownChildSessionIds: ReadonlySet<string>, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw new Error("SUBAGENT_ORPHAN_CLEANUP_CANCELLED");
    for (const id of this.sessions.keys()) {
      if (signal?.aborted) throw new Error("SUBAGENT_ORPHAN_CLEANUP_CANCELLED");
      if (!knownChildSessionIds.has(id)) this.sessions.delete(id);
    }
  }
}

export class JsonlChildSessionRepository implements ChildSessionRepository {
  private readonly root: string;
  private readonly repo: JsonlSessionRepo;

  constructor(root: string) {
    this.root = path.resolve(root);
    this.repo = new JsonlSessionRepo({ fileSystem: new NodeExecutionEnv({ cwd: this.root }), sessionsRoot: this.root });
  }

  async create(input: { readonly id: string; readonly parentSessionId: string; readonly signal?: AbortSignal }): Promise<Session<any>> {
    await mkdir(this.root, { recursive: true });
    return this.repo.create({ cwd: this.root, id: input.id, parentSessionId: input.parentSessionId }, input.signal ? withAbortSignal(input.signal, TODO_CONTEXT) : TODO_CONTEXT);
  }

  async open(id: string, signal?: AbortSignal): Promise<Session<any> | undefined> {
    const context = signal ? withAbortSignal(signal, TODO_CONTEXT) : TODO_CONTEXT;
    await mkdir(this.root, { recursive: true });
    const metadata = (await this.repo.list({ cwd: this.root }, context)).find((item) => item.id === id);
    return metadata ? this.repo.open(metadata, context) : undefined;
  }

  async removeOrphans(knownChildSessionIds: ReadonlySet<string>, signal?: AbortSignal): Promise<void> {
    const context = signal ? withAbortSignal(signal, TODO_CONTEXT) : TODO_CONTEXT;
    await mkdir(this.root, { recursive: true });
    for (const metadata of await this.repo.list({ cwd: this.root }, context)) {
      if (!knownChildSessionIds.has(metadata.id)) await this.repo.delete(metadata, context);
    }
  }
}
