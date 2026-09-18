import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SqlGuard } from "./sql-guard.js";

/**
 * Gate A — external contract fixtures.
 *
 * The JSON fixture files under tests/contract-fixtures/ are language-independent:
 * the same cases run against the legacy Python implementations (tests/test_contract_fixtures*.py)
 * and against the TypeScript runtime here. A mismatch in either direction fails the gate.
 */
const fixturesRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../tests/contract-fixtures");

interface SqlGuardCase { name: string; sql: string; allowed: boolean; reasonContains?: string }
interface SqlGuardFixture { cases: SqlGuardCase[] }

describe("contract fixtures: sql-guard (legacy Python parity)", () => {
  it("behaves identically to the legacy SQLGuard on every fixture case", async () => {
    const fixture = JSON.parse(await readFile(path.join(fixturesRoot, "sql-guard.json"), "utf8")) as SqlGuardFixture;
    expect(fixture.cases.length).toBeGreaterThanOrEqual(30);
    const guard = new SqlGuard();
    for (const testCase of fixture.cases) {
      const result = guard.check(testCase.sql);
      expect(result.allowed, `case "${testCase.name}": allowed mismatch (${result.reason})`).toBe(testCase.allowed);
      if (testCase.reasonContains !== undefined) {
        expect(result.reason).toContain(testCase.reasonContains);
      }
    }
  });
});
