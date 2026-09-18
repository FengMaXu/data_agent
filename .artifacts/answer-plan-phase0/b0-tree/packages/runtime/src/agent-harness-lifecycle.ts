export interface AgentHarnessResolverOptions<TProfile, TAgent> {
  getProfile: () => Promise<TProfile>;
  create: (profile: TProfile, scope?: string) => Promise<TAgent>;
  key?: (profile: TProfile, scope?: string) => string;
}

export interface AgentHarnessResolver<TAgent> {
  /** Resolve the current agent, sharing initialization with concurrent callers in the same scope. */
  resolve(scope?: string): Promise<TAgent>;
  /** Start initialization without making startup wait for it. */
  warmup(onError?: (error: unknown) => void): void;
}

/**
 * Keeps one harness initialization in flight for each profile/scope key. A
 * failed initialization is discarded so the next request can retry it.
 */
export function createAgentHarnessResolver<TProfile, TAgent>(
  options: AgentHarnessResolverOptions<TProfile, TAgent>,
): AgentHarnessResolver<TAgent> {
  const keyOf = options.key ?? ((profile: TProfile, scope?: string) => `${JSON.stringify(profile) ?? ""}:${scope ?? ""}`);
  const agents = new Map<string, TAgent>();
  const inFlight = new Map<string, Promise<TAgent>>();

  async function resolve(scope?: string): Promise<TAgent> {
    const profile = await options.getProfile();
    const key = keyOf(profile, scope);
    const existing = agents.get(key);
    if (existing !== undefined) return existing;
    const pending = inFlight.get(key);
    if (pending) return pending;

    let tracked!: Promise<TAgent>;
    tracked = options.create(profile, scope).then(
      (created) => {
        agents.set(key, created);
        if (inFlight.get(key) === tracked) inFlight.delete(key);
        return created;
      },
      (error: unknown) => {
        if (inFlight.get(key) === tracked) inFlight.delete(key);
        throw error;
      },
    );
    inFlight.set(key, tracked);
    return tracked;
  }

  function warmup(onError?: (error: unknown) => void): void {
    void resolve().catch((error: unknown) => onError?.(error));
  }

  return { resolve, warmup };
}
