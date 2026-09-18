export interface ConcurrencyLease { release(): void; }
export interface ConcurrencyLimiter { acquire(signal?: AbortSignal): Promise<ConcurrencyLease>; }
export interface KeyedConcurrencyLimiter { acquire(key: string, signal?: AbortSignal): Promise<ConcurrencyLease>; }

interface Waiter {
  readonly resolve: (lease: ConcurrencyLease) => void;
  readonly reject: (error: Error) => void;
  readonly signal?: AbortSignal;
  readonly onAbort?: () => void;
}

export class BoundedConcurrencyLimiter implements ConcurrencyLimiter {
  private active = 0;
  private readonly waiters: Waiter[] = [];

  constructor(readonly maximum: number) {
    if (!Number.isSafeInteger(maximum) || maximum < 1) throw new Error("SUBAGENT_GLOBAL_CONCURRENCY_INVALID");
  }

  acquire(signal?: AbortSignal): Promise<ConcurrencyLease> {
    if (signal?.aborted) return Promise.reject(new Error("SUBAGENT_WAIT_CANCELLED"));
    if (this.active < this.maximum) {
      this.active += 1;
      return Promise.resolve(this.lease());
    }
    return new Promise((resolve, reject) => {
      const waiter: Waiter = { resolve, reject, ...(signal ? { signal } : {}) };
      const onAbort = () => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(new Error("SUBAGENT_WAIT_CANCELLED"));
      };
      if (signal) {
        Object.assign(waiter, { onAbort });
        signal.addEventListener("abort", onAbort, { once: true });
      }
      this.waiters.push(waiter);
    });
  }

  private lease(): ConcurrencyLease {
    let released = false;
    return {
      release: () => {
        if (released) return;
        released = true;
        const next = this.waiters.shift();
        if (next) {
          next.signal?.removeEventListener("abort", next.onAbort!);
          next.resolve(this.lease());
        } else {
          this.active -= 1;
        }
      },
    };
  }
}

export class BoundedKeyedConcurrencyLimiter implements KeyedConcurrencyLimiter {
  private readonly entries = new Map<string, { readonly limiter: BoundedConcurrencyLimiter; users: number }>();

  constructor(readonly maximumPerKey: number) {
    if (!Number.isSafeInteger(maximumPerKey) || maximumPerKey < 1) throw new Error("SUBAGENT_KEYED_CONCURRENCY_INVALID");
  }

  async acquire(key: string, signal?: AbortSignal): Promise<ConcurrencyLease> {
    if (!key) throw new Error("SUBAGENT_CONCURRENCY_KEY_REQUIRED");
    const entry = this.entries.get(key) ?? { limiter: new BoundedConcurrencyLimiter(this.maximumPerKey), users: 0 };
    this.entries.set(key, entry);
    entry.users += 1;
    let lease: ConcurrencyLease;
    try {
      lease = await entry.limiter.acquire(signal);
    } catch (error) {
      this.releaseUser(key, entry);
      throw error;
    }
    let released = false;
    return {
      release: () => {
        if (released) return;
        released = true;
        lease.release();
        this.releaseUser(key, entry);
      },
    };
  }

  private releaseUser(key: string, entry: { users: number }): void {
    entry.users -= 1;
    if (entry.users === 0 && this.entries.get(key) === entry) this.entries.delete(key);
  }
}

/** Process-wide guards shared by every Data Agent Session Host. */
export const processParentOperationConcurrency = new BoundedKeyedConcurrencyLimiter(2);
export const processChildConcurrency = new BoundedConcurrencyLimiter(4);
export const processExplorationConcurrency = new BoundedConcurrencyLimiter(4);
