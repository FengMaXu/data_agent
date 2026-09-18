import { describe, expect, it } from "vitest";
import { resolvePiModel } from "./pi-agent.js";

describe("Pi model adapter", () => {
  it("resolves a configured Data Agent profile through the Pi model registry", () => {
    const model = { provider: "openai", id: "gpt-test" } as any;
    const models = {
      getModel: (provider: string, id: string) => provider === "openai" && id === "gpt-test" ? model : undefined,
    } as any;
    expect(resolvePiModel(models, { provider: "openai", model: "gpt-test" })).toBe(model);
  });
});
