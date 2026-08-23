import { describe, expect, it } from "vitest";
import { InMemorySecretVault, ProviderRegistry } from "./providers.js";
import { resolvePiModel } from "./pi-agent.js";

describe("Provider profiles", () => {
  it("stores api keys encrypted and resolves them for Pi models", async () => {
    const vault = new InMemorySecretVault();
    const registry = new ProviderRegistry(vault);
    const saved = await registry.save({ name: "prod", provider: "openai-compatible", baseUrl: "https://api.example.com/v1", model: "glm-4", apiKey: "sk-secret", isDefault: true });
    expect(saved.apiKey).not.toContain("sk-secret");
    expect(registry.list()[0]).toMatchObject({ name: "prod", hasApiKey: true });

    const resolved = await registry.resolveForPi(saved.id);
    expect(resolved).toMatchObject({ provider: "openai", model: "glm-4" });
    expect(resolved!.apiKey).toBe("sk-secret");

    const models = { getModel: (provider: string, id: string) => ({ provider, id }) } as any;
    const model = resolvePiModel(models, { provider: resolved!.provider, model: resolved!.model });
    expect(model).toEqual({ provider: "openai", id: "glm-4" });
  });

  it("enforces a single default profile", async () => {
    const registry = new ProviderRegistry(new InMemorySecretVault());
    await registry.save({ name: "a", provider: "openai", model: "gpt-x", isDefault: true });
    await registry.save({ name: "b", provider: "anthropic", model: "claude-x", isDefault: true });
    const defaults = registry.list().filter(p => (p as any).isDefault);
    expect(defaults).toHaveLength(1);
  });
});
