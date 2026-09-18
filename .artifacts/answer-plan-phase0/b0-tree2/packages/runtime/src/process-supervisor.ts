import { spawn, type ChildProcess } from "node:child_process";

export interface SupervisedProcessOptions {
  name: string;
  command: string;
  args?: string[];
  restartDelayMs?: number;
  maxRestarts?: number;
  isHealthy?: (proc: ChildProcess) => boolean;
}

export type SupervisorState = "stopped" | "starting" | "running" | "restarting" | "failed" | "disposed";

/**
 * Shared process supervisor for long-lived child processes (KTX, MCP stdio servers).
 * Restarts the child after unexpected exits and stops it cleanly on dispose.
 */
export class ProcessSupervisor {
  private child?: ChildProcess;
  private state: SupervisorState = "stopped";
  private readonly listeners = new Set<(state: SupervisorState) => void>();
  private restarting = false;
  private disposed = false;

  constructor(private readonly options: SupervisedProcessOptions) {}

  subscribe(listener: (state: SupervisorState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getState(): SupervisorState { return this.state; }
  getPid(): number | undefined { return this.child?.pid; }

  private setState(state: SupervisorState): void {
    this.state = state;
    for (const listener of this.listeners) listener(state);
  }

  async start(): Promise<void> {
    if (this.disposed) throw new Error("SUPERVISOR_DISPOSED");
    this.setState("starting");
    this.spawnChild();
    // Give the process a brief window to fail fast on bad commands.
    await new Promise((resolve) => setTimeout(resolve, 50));
    if (this.state === "failed") throw new Error(`PROCESS_FAILED:${this.options.name}`);
    this.setState("running");
  }

  private spawnChild(): void {
    this.child = spawn(this.options.command, this.options.args ?? [], { stdio: "ignore", windowsHide: true });
    this.child.on("error", () => this.handleExit());
    this.child.on("exit", () => this.handleExit());
  }

  private handleExit(): void {
    if (this.disposed || this.restarting) return;
    if (this.options.maxRestarts !== undefined && this.restartCount >= this.options.maxRestarts) {
      this.setState("failed");
      return;
    }
    this.restarting = true;
    this.setState("restarting");
    setTimeout(() => {
      this.restarting = false;
      this.restartCount += 1;
      this.spawnChild();
      this.setState("running");
    }, this.options.restartDelayMs ?? 100);
  }

  private restartCount = 0;

  async stop(): Promise<void> {
    this.disposed = true;
    const child = this.child;
    if (!child) { this.setState("stopped"); return; }
    await new Promise<void>((resolve) => {
      child.once("exit", () => resolve());
      try { child.kill(); } catch { resolve(); }
      setTimeout(resolve, 2000);
    });
    this.setState("stopped");
  }

  /** Health probe hook reserved for real health endpoints (KTX /health). */
  isHealthy(): boolean {
    return this.state === "running" && (this.options.isHealthy ? this.options.isHealthy(this.child!) : this.child?.exitCode === null);
  }
}

/** Internal tool identity: server-scoped to avoid collisions across MCP servers. */
export function semanticToolIdentity(serverName: string, toolName: string): string {
  return `mcp__${serverName}__${toolName}`;
}
