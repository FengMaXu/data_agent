import type { SubagentChildProgress, ToolProgress } from "@data-agent/contracts";
import type { ChildOutcome, ChildProgressEvent, SubagentInput } from "../delegation/index.js";

const TASK_PREVIEW_CHARS = 200;
/** Tool starts are coalesced; a child settling is published at once. */
const PUBLISH_INTERVAL_MS = 250;

type MutableProgress = { -readonly [K in keyof SubagentChildProgress]: SubagentChildProgress[K] };

function preview(task: string): string {
  const text = task.replace(/\s+/gu, " ").trim();
  return text.length > TASK_PREVIEW_CHARS ? `${text.slice(0, TASK_PREVIEW_CHARS - 1)}…` : text;
}

/**
 * Presentation-only view of one `subagent` call: per child, the latest tool,
 * how many tools it started, its timing and whether it produced a report.
 * It carries no SQL, report text or tool arguments.
 */
export class SubagentProgressTracker {
  private readonly children = new Map<string, MutableProgress>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private closed = false;

  constructor(
    input: SubagentInput,
    private readonly publish: (progress: ToolProgress) => void,
    private readonly now: () => number = Date.now,
  ) {
    const startedAt = this.now();
    for (const task of input.tasks) {
      this.children.set(task.key, {
        key: task.key,
        role: task.role,
        task: preview(task.task),
        currentTool: null,
        toolCalls: 0,
        startedAt,
        status: "running",
        output: "pending",
      });
    }
  }

  /** Publish the initial state so every child row appears before its first tool. */
  start(): void {
    this.flush();
  }

  apply(event: ChildProgressEvent): void {
    const child = this.children.get(event.key);
    if (this.closed || !child) return;
    if (event.type === "started") {
      child.startedAt = event.at;
    } else if (event.type === "tool_started") {
      child.currentTool = event.toolName.slice(0, 128);
      child.toolCalls += 1;
    } else {
      this.settle(child, event.status, event.reported, event.at);
      this.flush();
      return;
    }
    this.timer ??= setTimeout(() => this.flush(), PUBLISH_INTERVAL_MS);
  }

  /** Final per-child progress; children the delegation never reported settle from their outcome. */
  finish(outcomes: readonly ChildOutcome[]): ReadonlyMap<string, SubagentChildProgress> {
    const endedAt = this.now();
    for (const outcome of outcomes) {
      const child = this.children.get(outcome.key);
      if (child && child.status === "running") this.settle(child, outcome.status, outcome.report !== undefined, endedAt);
    }
    this.close();
    return new Map([...this.children].map(([key, child]) => [key, { ...child }]));
  }

  close(): void {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private settle(child: MutableProgress, status: ChildOutcome["status"], reported: boolean, at: number): void {
    child.status = status;
    child.output = reported ? "produced" : "none";
    child.endedAt = Math.max(at, child.startedAt);
  }

  private flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (this.closed) return;
    try {
      this.publish({ kind: "subagent", children: [...this.children.values()].map((child) => ({ ...child })) });
    } catch {
      // Progress is presentation only; it never affects the delegation.
    }
  }
}
