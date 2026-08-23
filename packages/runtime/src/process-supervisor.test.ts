import { describe, expect, it } from "vitest";
import { ProcessSupervisor, semanticToolIdentity } from "./process-supervisor.js";

describe("ProcessSupervisor", () => {
  it("restarts a child after unexpected exit and stops cleanly", async () => {
    const node = process.execPath;
    const supervisor = new ProcessSupervisor({
      name: "ktx-test",
      command: node,
      args: ["-e", "process.exit(0)"],
      restartDelayMs: 20,
      maxRestarts: 12,
    });
    const states: string[] = [];
    supervisor.subscribe((state) => states.push(state));
    await supervisor.start();
    expect(supervisor.getState()).toBe("running");
    const firstPid = supervisor.getPid();
    // Wait past several child lifecycles (each node boot costs ~100ms on Windows).
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(supervisor.getState()).toBe("running");
    expect(supervisor.getPid()).not.toBe(firstPid);
    await supervisor.stop();
    expect(supervisor.getState()).toBe("stopped");
  }, 10000);
});

describe("semantic tool identity", () => {
  it("scopes tool names per server", () => {
    expect(semanticToolIdentity("semantic", "sl_query")).toBe("mcp__semantic__sl_query");
  });
});
