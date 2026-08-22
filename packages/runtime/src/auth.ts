import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";

export interface AuthUser { id: string; username: string; displayName: string }
export class LocalAuthService {
  private users = new Map<string, { user: AuthUser; hash: Buffer; salt: Buffer }>();
  private tokens = new Map<string, AuthUser>();
  register(username: string, password: string, displayName = username): AuthUser {
    if (!username || !password || this.users.has(username)) throw new Error("AUTH_REGISTRATION_FAILED");
    const salt = randomBytes(16); const hash = scryptSync(password, salt, 32); const user = { id: randomUUID(), username, displayName };
    this.users.set(username, { user, hash, salt }); return user;
  }
  login(username: string, password: string): { user: AuthUser; token: string } {
    const record = this.users.get(username); if (!record) throw new Error("AUTH_INVALID_CREDENTIALS");
    const hash = scryptSync(password, record.salt, 32); if (!timingSafeEqual(hash, record.hash)) throw new Error("AUTH_INVALID_CREDENTIALS");
    const token = randomBytes(32).toString("hex"); this.tokens.set(token, record.user); return { user: record.user, token };
  }
  authenticate(token: string | undefined): AuthUser | undefined { return token ? this.tokens.get(token) : undefined; }
  logout(token: string): void { this.tokens.delete(token); }
}
