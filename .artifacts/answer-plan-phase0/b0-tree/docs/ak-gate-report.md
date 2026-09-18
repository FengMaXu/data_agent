# A–K Readiness Gate Report — Data Agent TypeScript Migration

- **Ticket**: FengMaXu/data_agent#27
- **Date**: 2026-08-24
- **Platform**: Windows x64, Node v22.22.3, Electron 39.2.7
- **Overall verdict**: **11 / 11 gates PASS** (one documented packaging-tool workaround, see Gate J)

## Test suite totals (this run)

| Suite | Files | Tests |
|---|---|---|
| packages/runtime (vitest) | 27 | 49 |
| packages/transport (vitest) | 1 | 2 |
| packages/electron-host (vitest) | 2 | 4 |
| apps/server (vitest) | 5 | 9 |
| frontend (vitest) | 3 | 10 |
| legacy Python contract fixtures (pytest) | 1 | 31 |
| **Total** | **39** | **105** |

---

## Gate A — Legacy Python ↔ TypeScript behaviour via external contract fixtures — **PASS**

- Shared, language-independent fixtures: `tests/contract-fixtures/sql-guard.json` (31 cases).
- Legacy runner: `tests/test_contract_fixtures_sql_guard.py` executes the fixtures against `src/mcp/sql_guard.py` (the Python production guard) — **31/31 passed**.
- TypeScript runner: `packages/runtime/src/contract-fixtures.test.ts` executes the identical fixtures against the new `packages/runtime/src/sql-guard.ts` — **passed**.
- The TS guard is now the single implementation behind both SQL execution surfaces: `dashboard.evaluate` (Runtime) and `execute_query_preview` (SQLite reference MCP server); both were migrated off their earlier simplified regexes.
- Fixture coverage: empty/whitespace rejection, all 15 dangerous-keyword families, injection patterns (multi-statement, block comments, UNION/EXEC/XP_), CTE/WITH and parameterized reads allowed, word-boundary semantics inside identifiers.
- Diverged-by-design behaviours (dashboard V3 dataset embedding, transcript ownership) are covered by their own ticket-level tests (#22, #25) and are not part of the parity fixture set.

## Gate B — Migration, backup, rollback on representative data — **PASS**

`packages/runtime/src/legacy-migration.test.ts` (representative fixture: SQLite metadata with tasks + chat sessions incl. UI transcript/context messages/active skills/attached files/conversation version, Pi session snapshot, interrupted-migration corrupt DB):

- Migration of tasks/sessions/projections/snapshots with warnings for corrupt sources — **pass**.
- **No side-effect replay**: historical `toolResult` messages preserved verbatim (1 migrated), never re-executed; unsupported future roles skipped with warnings — **pass**.
- **Backup before migrate** (full source copy under `migration-backup/<migrationId>`), idempotent re-run returns the same report — **pass**.
- **Rollback** (`rollbackMigration`): removes the completion marker, restores derived dirs from the backup, allows a fresh migration afterwards; no-op safe when nothing to roll back — **pass**.

## Gate C — Windows clean-environment tests — **PASS**

`scripts/run-clean-env-gates.mjs` (clean dist deletion → full rebuild → all smokes):

| Gate | Result | Duration |
|---|---|---|
| C1 clean distribution build | PASS | 107s |
| C2 Fastify Web Host smoke | PASS | 2s |
| C3 Python runtime pack smoke | PASS | 1s |
| C4 Electron packaging (unpacked + NSIS installer) | PASS | 305s |
| C5 packaged Electron startup smoke (`DATA_AGENT_SMOKE=1`) | PASS | 12s |
| C6 component/latency budgets | PASS | 4s |

## Gate D — Security boundaries — **PASS**

- **Path safety**: workspace store rejects paths outside the workspace root (`WORKSPACE_PATH_ESCAPE`); knowledge writes enforce user authority with `.pi/` immutable (knowledge-write tests).
- **Ownership**: Electron IPC host never trusts renderer identity (identity-protection test); Web host enforces session ownership and auth (e2e-web suite).
- **Secret redaction**: `ProviderRegistry.list()` omits `apiKey` and returns `hasApiKey` only; secrets encrypted at rest via the safeStorage port (providers tests).
- **SQL safety**: full legacy-parity `SqlGuard` at both execution surfaces (Gate A) plus server-side limit enforcement in MCP packs.

## Gate E — Dashboard bridge and V3/V4 — **PASS**

- `dashboard.evaluate`: read-only guarded SQL via injected `queryExecutor` port, `FORBIDDEN_SQL_IN_EVALUATE` on guard hits, row limit capped at 10 000 (dashboard-evaluate tests).
- V3 canonical artifacts embed datasets inline; legacy artifacts surface `LEGACY_DASHBOARD_REQUIRES_REGENERATION` (dashboard-v3 tests).
- V4 semantic dashboards generated through the restricted bridge (dashboard-v4 tests).

## Gate F — Knowledge — **PASS**

Markdown discovery, BM25/FTS retrieval, incremental index updates, atomic writes, drafts, canonical `.pi/` write rejection, and audit records (knowledge/knowledge-write/knowledge-command suites).

## Gate G — MCP database families — **PASS**

- SQLite reference server: contract negotiation, server-side limit enforcement, dangerous-SQL rejection, preview truncation, export resource transfer (reference-sqlite tests, incl. real client↔server).
- MySQL pack: wire-protocol contract tests against a disposable local MySQL harness.
- PostgreSQL pack: contract tests over PGlite wire protocol.
- Namespaced semantic tool surface under supervisor control (#19).

## Gate H — Hosts (Electron IPC + Web HTTP) — **PASS**

- Electron: versioned `data-agent:command` envelope dispatch with identity protection (4 tests).
- Web: Fastify adapter with auth, `/auth/status`, SSE `/api/runtime/events`, full task/session/transcript/knowledge/settings/semantic/MCP capability e2e (9 tests incl. e2e-web).

## Gate I — Python Runtime packs — **PASS**

Deterministic bundled pack (~173 MB) with manifest; smoke covers interpreter probe, script execution, Unicode output, timeout/cancellation, artifact capture (`smoke-python-runtime.mjs` + python-runtime/python-job suites). `python.runtime.test` performs real interpreter probes; the Electron host resolves the pack from `process.resourcesPath` with no development-path fallback.

## Gate J — Packaging — **PASS (with documented workaround)**

- `app.asar` contains only the application (renderer dist, preload, electron-host bundle, better-sqlite3 + runtime deps); **no user data, no Python Web backend**.
- Native module: `*.node` unpacked to `app.asar.unpacked`, Electron-ABI prebuild fetched at package time (Node-ABI workspace copy untouched).
- NSIS installer produced (`Data Agent Setup.exe`, ~194 MB).
- **Workaround**: electron-builder's own staging flow deterministically fails on this machine with `EPERM` renaming `win-unpacked.tmp` (real-time protection holds the freshly extracted directory; reproduced on C:\ and D:\ with `npmRebuild=false`). `scripts/package-electron-manual.mjs` + `installer.template.nsi` perform the identical steps deterministically and are the canonical packaging path.

## Gate K — Performance budgets — **PASS**

Measured 2026-08-24 (`docs/gate-metrics.json`):

| Metric | Budget | Actual | Result |
|---|---|---|---|
| app.asar | ≤ 30 MB | 12.8 MB | PASS |
| python-runtime pack | ≤ 400 MB | 172.9 MB | PASS |
| unpacked app | ≤ 900 MB | 513.1 MB | PASS |
| installer | ≤ 350 MB | 194.0 MB | PASS |
| Runtime command round-trip p95 | ≤ 200 ms | 2.9 ms (p50 1.1 ms, n=100, 10 warmup) | PASS |

- Command latency is measured in-process over the production `DataAgentRuntime.dispatch` seam (worker-thread SQLite hop included).
- **First paint / Runtime-ready**: packaged cold start to `smoke.ok` (runtime constructed, stores open, IPC registered) measured at 12–20 s wall clock on this workstation; the windowed Renderer loads `dist/index.html` immediately after `whenReady` (first-paint baseline tracked in `docs/gate-metrics.json` on each `run-clean-env-gates.mjs` run).
- **First token**: depends on a configured live LLM provider; measured on demand via `agent.prompt` streaming with the configured profile. Not a packaging gate — the Runtime emits first-token deltas through the same event pipeline verified by the agent contract tests.

---

## Conclusion

All A–K gates pass on the current master (`9870a16` + gate commits). The remaining sequence per #1 is #28 (stop the Python Web backend, remove FastAPI/PyInstaller artifacts) followed by the final clean-build/migration verification and #29 (V3→canonical V4 convergence).
