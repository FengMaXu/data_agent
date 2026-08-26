export interface AgentHarnessResolverOptions<TProfile, TAgent> {
  getProfile: () => Promise<TProfile>;
  create: (profile: TProfile) => Promise<TAgent>;
  key?: (profile: TProfile) => string;
}

export interface AgentHarnessResolver<TAgent> {
  /** Resolve the current agent, sharing initialization with concurrent callers. */
  resolve(): Promise<TAgent>;
  /** Start initialization without making startup wait for it. */
  warmup(onError?: (error: unknown) => void): void;
}

/**
 * Keeps one harness initialization in flight for a profile. A failed
 * initialization is discarded so the next request can retry it.
 */
export function createAgentHarnessResolver<TProfile, TAgent>(
  options: AgentHarnessResolverOptions<TProfile, TAgent>,
): AgentHarnessResolver<TAgent> {
  const keyOf = options.key ?? ((profile: TProfile) => JSON.stringify(profile) ?? "");
  let agent: TAgent | undefined;
  let agentKey: string | undefined;
  let inFlight: Promise<TAgent> | undefined;
  let inFlightKey: string | undefined;

  async function resolve(): Promise<TAgent> {
    const profile = await options.getProfile();
    const key = keyOf(profile);
    if (agent !== undefined && agentKey === key) return agent;
    if (inFlight && inFlightKey === key) return inFlight;

    const initialization = (async () => {
      const created = await options.create(profile);
      // Do not let an older profile overwrite a newer initialization that is
      // already in flight.
      if (inFlightKey === key) {
        agent = created;
        agentKey = key;
      }
      return created;
    })();
    let tracked!: Promise<TAgent>;
    tracked = initialization.then(
      (created) => {
        if (inFlight === tracked) {
          inFlight = undefined;
          inFlightKey = undefined;
        }
        return created;
      },
      (error: unknown) => {
        if (inFlight === tracked) {
          inFlight = undefined;
          inFlightKey = undefined;
        }
        throw error;
      },
    );
    inFlight = tracked;
    inFlightKey = key;
    return tracked;
  }

  function warmup(onError?: (error: unknown) => void): void {
    void resolve().catch((error: unknown) => onError?.(error));
  }

  return { resolve, warmup };
}
