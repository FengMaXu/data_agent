/**
 * SQL safety guard — TypeScript port of the legacy Python `src/mcp/sql_guard.py`.
 *
 * This module is the language-independent contract implementation used by the
 * A–K readiness gate: the same JSON fixtures under `tests/contract-fixtures/`
 * are executed against this implementation and against the legacy Python
 * `SQLGuard` to prove behaviour parity.
 *
 * Parity notes (verified against the legacy implementation):
 * - empty/whitespace-only SQL is rejected with "Empty query"
 * - injection patterns are checked first, then dangerous keywords
 * - reasons are "SQL blocked: injection pattern detected [<pattern>]" and
 *   "SQL blocked: high-risk operation detected [<pattern>]"
 * - matching is case-insensitive; injection patterns are dot-all
 */

export const DANGEROUS_KEYWORDS = [
  "\\bDROP\\b",
  "\\bTRUNCATE\\b",
  "\\bDELETE\\b",
  "\\bALTER\\b",
  "\\bGRANT\\b",
  "\\bREVOKE\\b",
  "\\bINSERT\\b",
  "\\bUPDATE\\b",
  "\\bCALL\\b",
  "\\bCREATE\\b",
  "\\bRENAME\\b",
  "\\bREPLACE\\b", // REPLACE INTO
  "\\bLOAD\\s+DATA\\b",
  "\\bINTO\\s+OUTFILE\\b",
  "\\bINTO\\s+DUMPFILE\\b",
] as const;

export const INJECTION_PATTERNS = [
  ";\\s*\\w", // Multi-statement injection.
  // Standard SQL line comments (-- text) are valid and are not high-risk alone.
  "/\\*.*?\\*/", // Block comments can hide dangerous keywords.
  "\\bUNION\\s+(ALL\\s+)?SELECT\\b",
  "\\bEXEC\\b",
  "\\bXP_\\w+",
] as const;

export interface SqlGuardResult {
  allowed: boolean;
  reason: string;
}

export class SqlGuard {
  private readonly dangerousPatterns: RegExp[];
  private readonly injectionPatterns: RegExp[];

  constructor(public readonly strict = true) {
    this.dangerousPatterns = DANGEROUS_KEYWORDS.map((p) => new RegExp(p, "i"));
    this.injectionPatterns = INJECTION_PATTERNS.map((p) => new RegExp(p, "is"));
  }

  check(sql: string): SqlGuardResult {
    if (!sql || !sql.trim()) return { allowed: false, reason: "Empty query" };
    const sqlClean = sql.trim();
    for (const pattern of this.injectionPatterns) {
      if (pattern.test(sqlClean)) {
        return { allowed: false, reason: `SQL blocked: injection pattern detected [${pattern.source}]` };
      }
    }
    for (const pattern of this.dangerousPatterns) {
      if (pattern.test(sqlClean)) {
        return { allowed: false, reason: `SQL blocked: high-risk operation detected [${pattern.source}]` };
      }
    }
    return { allowed: true, reason: "" };
  }
}
