import { describe, expect, it } from "vitest";
import { SqlGuard } from "./sql-guard.js";

describe("SqlGuard read-only SQL surface", () => {
  const guard = new SqlGuard();

  it("allows read-only UNION queries", () => {
    expect(guard.check("SELECT a FROM t UNION SELECT b FROM u").allowed).toBe(true);
    expect(guard.check("SELECT a FROM t UNION ALL SELECT b FROM u").allowed).toBe(true);
  });

  it("allows the scalar REPLACE function but blocks REPLACE INTO", () => {
    expect(guard.check("SELECT REPLACE(name, 'old', 'new') FROM users").allowed).toBe(true);
    const blocked = guard.check("REPLACE INTO users SELECT * FROM archive");
    expect(blocked.allowed).toBe(false);
    expect(blocked.reason).toContain("high-risk");
  });

  it("continues to block write operations and multi-statement SQL", () => {
    expect(guard.check("INSERT INTO users VALUES (1)").allowed).toBe(false);
    expect(guard.check("SELECT 1; DROP TABLE users").allowed).toBe(false);
  });
});
