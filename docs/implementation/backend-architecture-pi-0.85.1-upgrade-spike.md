# Pi 0.83 → 0.85.1 Upgrade Spike Record

Status: **accepted for the Data Agent production baseline**  
Design authority: `docs/backend_architecture_decoupling_analysis_and_plan.md` §14  
Target upstream commit: `71dca871bc80b6bc97be37f0ca3189399d651fff`

## Frozen versions

| Item | Frozen value |
|---|---|
| `@earendil-works/pi-agent-core` | `0.85.1` |
| `@earendil-works/pi-ai` | `0.85.1` |
| `@earendil-works/chord` | `0.85.1` |
| Pi JSONL format version | `4` |
| Pi Session `storageVersion` | `1` |
| Data Agent offline Session migration version | `1` (`MigrationReport.migrationVersion`) |
| Hook contract version | Pi `0.85.1` `HookMap` + Data Agent bounded-follow-up policy v1 |

The exact package releases are pinned in both `package.json` and `package-lock.json`; production does not follow Pi `main`.

## §14.1 verification matrix

| Requirement | Decision/evidence |
|---|---|
| `AgentHarness.create(options, context)` | Used by `packages/runtime/src/agent/harness-factory.ts`; exercised by `pi-lane-recovery.test.ts`. |
| Session/`JsonlSessionRepo` create, open, close | `PiJsonlSessionStore` and recovery tests create, close, reconstruct and reopen the same Session. |
| `AgentLane.accept/drive/requestAbort/watch` | `pi-lane-recovery.test.ts` covers accept-before-drive persistence, reconstruction, drive, current/stale abort identity, initial watch snapshot, resnapshot and settled events. |
| Tool invocation memo/checkpoint/replay | Native safe-tool test exercises opaque invocation identity plus `setMemo/getMemo`. Answering replay tests persist only `ResultRef`/hash, recover after Candidate commit failure and refuse an unknown external outcome instead of rerunning SQL. No result rows are checkpointed into Pi. |
| Hook registration/repetition | Native `before_run_end` test returns one bounded follow-up and proves the hook is invoked twice with the same Pi run identity. Production authorization does not depend on a Hook. |
| Memory/JSONL/SQLite choice | Memory is used only for isolated/in-memory composition. JSONL is the selected durable Pi Session backend and is covered by reopen/recovery tests. SQLite remains metadata/projection storage, not a second writable Pi Session authority. No Pi SQLite backend is selected. |
| Windows/Electron | `npm run build:distribution`, manual Windows package construction, native `better-sqlite3` Electron ABI installation and packaged renderer smoke all pass. Smoke coverage marker: `renderer-runtime-config-upload-chat`. |
| Existing Session migration | No unverified 0.83 Session is opened in place. `migrateLegacyData` is an explicit, versioned, offline migration with backup/rollback; supported transcript records are copied into a newly created 0.85 Session and legacy snapshots are retained as read-only `.legacy.json` exports. |
| Python credential isolation | `python-job.test.ts` proves model/database/cloud credential variables are removed before child-process spawn. Python is a capability and never receives the Pi credential store. |
| `watchSession` | Not used or required. Lane snapshot/watch is the recovery and hydration dependency. |

## Session migration policy

Selected policy: **offline one-time migration**.

1. Stop the old writer.
2. Create a backup and a migration marker containing `migrationVersion: 1`.
3. Copy only supported conversation content into a new Pi 0.85 Session.
4. Preserve unsupported legacy snapshots as read-only exports.
5. Never let old and new Harness implementations write the same Session.
6. New production tasks use only the Pi 0.85 Session + `PiSessionAnsweringStore` path.

There is no permanent compatibility writer and no QA JSON state migration into Pi.

## Reproduction commands

```text
npm run -w @data-agent/runtime typecheck:negative
npm test -w @data-agent/runtime
npm run build:distribution
node scripts/smoke-web-host.mjs
node scripts/package-electron-manual.mjs frontend/release-final/win-unpacked
node scripts/smoke-electron.mjs frontend/release-final/win-unpacked
npm run verify:architecture
```

Observed packaged smoke result: `electron smoke PASS (...; renderer-runtime-config-upload-chat)`.
