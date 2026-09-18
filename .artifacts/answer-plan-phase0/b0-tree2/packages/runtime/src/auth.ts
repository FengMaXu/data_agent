import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";

export interface AuthUser { id: string; username: string; displayName: string }

/**
 * Minimal store contract (satisfied by MetadataStore) so credentials and
 * sessions survive host restarts. Without a store the service falls back to
 * an in-memory mode intended for tests only.
 */
export interface LocalAuthStore {
  call(op: string, userId: string, values?: Record<string, unknown>): Promise<any>;
}

interface UserRecord { user: AuthUser; hash: Buffer; salt: Buffer }

export class LocalAuthService {
  private users = new Map<string, UserRecord>();
  private tokens = new Map<string, AuthUser>();
  constructor(private readonly store?: LocalAuthStore) {}

  private hash(password: string, salt: Buffer): Buffer { return scryptSync(password, salt, 32); }

  /** Number of registered accounts (0 ⇒ registration open for the first admin). */
  async userCount(): Promise<number> {
    if (!this.store) return this.users.size;
    const result = await this.store.call("auth.userCount", "system") as { count: number };
    return Number(result?.count ?? 0);
  }

  async register(username: string, password: string, displayName = username): Promise<AuthUser> {
    if (!username || !password) throw new Error("AUTH_REGISTRATION_FAILED");
    if (!this.store) {
      if (this.users.has(username)) throw new Error("AUTH_REGISTRATION_FAILED");
      const salt = randomBytes(16); const user = { id: randomUUID(), username, displayName };
      this.users.set(username, { user, hash: this.hash(password, salt), salt });
      return user;
    }
    if ((await this.userCount()) > 0) throw new Error("AUTH_REGISTRATION_CLOSED");
    const salt = randomBytes(16);
    const user = { id: randomUUID(), username, displayName };
    const result = await this.store.call("auth.register", "system", {
      username, userId: user.id, displayName, salt: salt.toString("hex"), hash: this.hash(password, salt).toString("hex"),
    }) as { ok: boolean; reason?: string };
    if (!result?.ok) throw new Error(result?.reason ?? "AUTH_REGISTRATION_FAILED");
    return user;
  }

  async login(username: string, password: string): Promise<{ user: AuthUser; token: string }> {
    if (!this.store) {
      const record = this.users.get(username); if (!record) throw new Error("AUTH_INVALID_CREDENTIALS");
      if (!timingSafeEqual(this.hash(password, record.salt), record.hash)) throw new Error("AUTH_INVALID_CREDENTIALS");
      const token = randomBytes(32).toString("hex"); this.tokens.set(token, record.user);
      return { user: record.user, token };
    }
    const row = await this.store.call("auth.verify", "system", { username }) as
      { userId: string; displayName: string; salt: string; hash: string } | null;
    if (!row) throw new Error("AUTH_INVALID_CREDENTIALS");
    const salt = Buffer.from(row.salt, "hex");
    if (!timingSafeEqual(this.hash(password, salt), Buffer.from(row.hash, "hex"))) throw new Error("AUTH_INVALID_CREDENTIALS");
    const user = { id: row.userId, username, displayName: row.displayName };
    const token = randomBytes(32).toString("hex");
    await this.store.call("auth.token.set", "system", { token, userId: user.id, username: user.username, displayName: user.displayName });
    return { user, token };
  }

  async authenticate(token: string | undefined): Promise<AuthUser | undefined> {
    if (!token) return undefined;
    if (!this.store) return this.tokens.get(token);
    const row = await this.store.call("auth.token.get", "system", { token }) as
      { userId: string; username: string; displayName: string } | null;
    return row ? { id: row.userId, username: row.username, displayName: row.displayName } : undefined;
  }

  async logout(token: string): Promise<void> {
    if (!this.store) { this.tokens.delete(token); return; }
    await this.store.call("auth.token.delete", "system", { token });
  }
}
