# Spider2 Evaluation Monitor — Interim Status

## Review

- **Status:** **Incomplete / still active**
- **Run ID:** `spider2-gold109-deepseek-flash-001`
- **PID:** `1069`
- **Denominator:** 109 cases
- **Manifest:** `status: "running"`, started at `2026-09-11T05:04:03.845Z`
- **Latest process check:** PID 1069 remains active.

### Current counts

| State | Count |
|---|---:|
| Completed | 3 |
| In progress | 3 |
| Not yet observed | 103 |
| Total | 109 |

Completed cases are `local007`, `local008`, and `local009`. Cases `local015`, `local017`, and `local019` are in progress.

### Delivery coverage so far

- SQL delivered: **3/3 completed cases**
- CSV delivered: **3/3 completed cases**
- Final fixed-denominator coverage: unavailable until completion

### Final metrics unavailable

The following cannot yet be reported without inventing results:

- Official SQL fixed-denominator score
- Official E2E fixed-denominator score
- Final status counts
- Turns, tool calls, and token totals
- Hook/disposition metrics
- Final failure inventory

No definite case failure was observed. The log’s `[mcp-query-executor] transport closed` message was followed by successful completion (`sql=true csv=true`) and is not sufficient evidence of failure.

### Artifacts

- PID: `D:/data_agent/.artifacts/spider2-gold109-deepseek-flash/run.pid`
- Log: `D:/data_agent/.artifacts/spider2-gold109-deepseek-flash/run.log`
- Run directory: `C:/data-agent-eval/runs/spider2-gold109-deepseek-flash-001`
- Manifest: `C:/data-agent-eval/runs/spider2-gold109-deepseek-flash-001/manifest.json`
- Expected summary: `C:/data-agent-eval/runs/spider2-gold109-deepseek-flash-001/summary.json` — not generated yet
- Expected official score: `C:/data-agent-eval/runs/spider2-gold109-deepseek-flash-001/official_score/summary.json` — not generated yet
- Expected report: `C:/data-agent-eval/runs/spider2-gold109-deepseek-flash-001/report.md` — not generated yet

- **Finding: P2** — Final evaluation results are unavailable because the recorded process remains active and the manifest remains `running`.
- **Merge verdict:** **OK with notes** — this is an accurate interim report, not a final evaluation result.