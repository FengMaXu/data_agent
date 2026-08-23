import { randomUUID } from "node:crypto";

export interface LLMProfile {
  id: string;
  name: string;
  provider: "openai" | "openai-compatible" | "anthropic";
  baseUrl?: string;
  model: string;
  apiKey?: string;
  isDefault?: boolean;
}

/** Port implemented by the Electron Host using safeStorage; tests use in-memory. */
export interface SecretVault {
  encrypt(plain: string): Promise<string>;
  decrypt(cipher: string): Promise<string>;
}

export class InMemorySecretVault implements SecretVault {
  private readonly store = new Map<string, string>();
  async encrypt(plain: string): Promise<string> { const id = randomUUID(); this.store.set(id, plain); return `mem:${id}`; }
  async decrypt(cipher: string): Promise<string> { if (!cipher.startsWith("mem:")) throw new Error("UNKNOWN_SECRET_FORMAT"); return this.store.get(cipher.slice(4)) ?? ""; }
}

export class ProviderRegistry {
  private profiles = new Map<string, LLMProfile>();
  constructor(private readonly vault: SecretVault) {}

  async save(profile: Omit<LLMProfile, "id"> & { id?: string }): Promise<LLMProfile> {
    const id = profile.id ?? randomUUID();
    let apiKey: string | undefined;
    if (profile.apiKey) apiKey = await this.vault.encrypt(profile.apiKey);
    const stored: LLMProfile = { ...profile, id, apiKey };
    if (stored.isDefault) for (const p of this.profiles.values()) p.isDefault = false;
    this.profiles.set(id, stored);
    return stored;
  }

  list(): Array<Omit<LLMProfile, "apiKey">> {
    return [...this.profiles.values()].map(({ apiKey, ...rest }) => ({ ...rest, hasApiKey: Boolean(apiKey) } as any));
  }

  async resolveForPi(id: string): Promise<{ provider: string; model: string; apiKey?: string } | undefined> {
    const profile = this.profiles.get(id);
    if (!profile) return undefined;
    return {
      provider: profile.provider === "anthropic" ? "anthropic" : "openai",
      model: profile.model,
      apiKey: profile.apiKey ? await this.vault.decrypt(profile.apiKey) : undefined,
    };
  }

  getDefault(): LLMProfile | undefined {
    return [...this.profiles.values()].find(p => p.isDefault);
  }
}
