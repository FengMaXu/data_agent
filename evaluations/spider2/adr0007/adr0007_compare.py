"""Compare ADR-0007 arms (legacy, phase-1 fields, field tree, ...) from Spider2 run traces.

Usage: adr0007_compare.py label=run-id [label=run-id ...]; a bare run id is labelled by position.
"""
import glob
import json
import os
import statistics
import sys

RUNS = "C:/data-agent-eval/runs"
SPEC_TOOLS = {"begin_answer_spec", "revise_answer_spec", "set_answer_spec"}
PUBLISH_TOOLS = {"export_query", "publish_query_result"}


def load(path):
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


LEGACY_BLOCKERS = ("unresolvedFacets", "unresolvedHypotheses", "unresolvedChoices", "undeclaredDecisionPoints")
FIELD_BLOCKERS = ("undeclared", "open")


def is_ready(details):
    """Ready when nothing blocks the result query, in either the legacy or the field-tree view."""
    keys = FIELD_BLOCKERS if "undeclared" in details else LEGACY_BLOCKERS
    return all(not details.get(key) for key in keys)


def official_correct(run_dir):
    """Per-case correctness from the official scorer (exec_result mode), once `score` has run."""
    path = os.path.join(run_dir, "official_score", "summary.json")
    if not os.path.exists(path):
        return {}
    scores = (load(path).get("execResult") or {}).get("caseScores") or {}
    return {case: bool(score) for case, score in scores.items()}


def analyse(run_id):
    run_dir = os.path.join(RUNS, run_id)
    correct = official_correct(run_dir)
    rows = []
    for case_dir in sorted(glob.glob(os.path.join(run_dir, "cases", "*"))):
        case = os.path.basename(case_dir)
        if not os.path.exists(os.path.join(case_dir, "trace.json")):
            rows.append({"case": case, "missing": True})
            continue
        trace = load(os.path.join(case_dir, "trace.json"))
        result = load(os.path.join(case_dir, "result.json"))
        assistant_times = sorted(
            event["message"]["timestamp"]
            for event in trace["events"]
            if event.get("type") == "message_end" and (event.get("message") or {}).get("role") == "assistant" and event["message"].get("timestamp") is not None
        )
        spec_calls = [call for call in trace["toolCalls"] if call["toolName"] in SPEC_TOOLS]
        spec_errors = [call for call in spec_calls if call["isError"]]
        path_total = path_rejected = 0
        first_ready_turn = None
        for call in spec_calls:
            if call["isError"]:
                continue
            details = (call.get("result") or {}).get("details") or {}
            if call["toolName"] == "set_answer_spec":
                # Count rejected paths from the call's own outcome lines.
                text = "".join(part.get("text", "") for part in (call.get("result") or {}).get("content", []) if isinstance(part, dict))
                path_total += sum(1 for line in text.splitlines() if line.startswith("- ✓ ") or line.startswith("- ✗ "))
                path_rejected += sum(1 for line in text.splitlines() if line.startswith("- ✗ "))
            if first_ready_turn is None and is_ready(details):
                first_ready_turn = sum(1 for stamp in assistant_times if stamp <= call["startedAt"])
        publishes = [call for call in trace["toolCalls"] if call["toolName"] in PUBLISH_TOOLS and not call["isError"]]
        disclosure = None
        if publishes:
            details = (publishes[-1].get("result") or {}).get("details") or {}
            disclosure = bool(details.get("disclosure"))
        rows.append({
            "case": case,
            "status": result.get("status"),
            "turns": result.get("turns"),
            "durationMs": result.get("durationMs"),
            "toolCalls": len(trace["toolCalls"]),
            "toolErrors": sum(1 for call in trace["toolCalls"] if call["isError"]),
            "specCalls": len(spec_calls),
            "specErrors": len(spec_errors),
            "pathTotal": path_total,
            "pathRejected": path_rejected,
            "firstReadyTurn": first_ready_turn,
            "published": bool(publishes),
            "disclosed": disclosure,
            "correct": correct.get(case),
        })
    return rows


def summarise(label, rows):
    done = [row for row in rows if not row.get("missing")]
    spec_calls = sum(row["specCalls"] for row in done)
    spec_errors = sum(row["specErrors"] for row in done)
    ready = [row["firstReadyTurn"] for row in done if row["firstReadyTurn"] is not None]
    published = [row for row in done if row["published"]]
    disclosed = [row for row in published if row["disclosed"]]
    scored = [row for row in done if row["correct"] is not None]
    path_total = sum(row["pathTotal"] for row in done)
    path_rejected = sum(row["pathRejected"] for row in done)
    pct = lambda part, whole: f"{part}/{whole} ({100 * part / whole:.0f}%)" if whole else "n/a"
    durations = [row["durationMs"] / 1000 for row in done if row.get("durationMs") is not None]
    statuses = {}
    for row in done:
        statuses[row["status"]] = statuses.get(row["status"], 0) + 1
    return {
        "arm": label,
        "cases finished": f"{len(done)}/{len(rows)}",
        "status": ", ".join(f"{key}={value}" for key, value in sorted(statuses.items(), key=lambda item: str(item[0]))),
        "duration total (s)": round(sum(durations)) if durations else "n/a",
        "duration median (s)": round(statistics.median(durations)) if durations else "n/a",
        "tool error rate (all tools)": pct(sum(row["toolErrors"] for row in done), sum(row["toolCalls"] for row in done)),
        "spec call error rate": pct(spec_errors, spec_calls),
        "spec path rejection (fields only)": pct(path_rejected, path_total) if path_total else "n/a",
        "reached Ready": pct(len(ready), len(done)),
        "turns to first Ready (median)": statistics.median(ready) if ready else "n/a",
        "turns to first Ready (mean)": round(statistics.mean(ready), 1) if ready else "n/a",
        "published": pct(len(published), len(done)),
        "disclosure rate (of published)": pct(len(disclosed), len(published)),
        "correct (official)": pct(sum(1 for row in scored if row["correct"]), len(scored)) if scored else "not scored",
        "median turns per case": statistics.median([row["turns"] for row in done if row["turns"] is not None]) if done else "n/a",
    }


if __name__ == "__main__":
    arms = {}
    for index, argument in enumerate(sys.argv[1:]):
        label, _, run_id = argument.partition("=")
        arms[label if run_id else f"arm{index + 1}"] = run_id or label
    analysed = {label: analyse(run_id) for label, run_id in arms.items()}
    summaries = [summarise(label, rows) for label, rows in analysed.items()]
    for key in summaries[0]:
        print(f"{key:36} | " + " | ".join(f"{str(summary[key]):30}" for summary in summaries))
    print()
    cases = sorted({row["case"] for rows in analysed.values() for row in rows})
    by_case = {label: {row["case"]: row for row in rows} for label, rows in analysed.items()}
    print(f"{'case':10} | " + " | ".join(f"{label + ' spec err/calls  s  ok':34}" for label in arms))
    for case in cases:
        cells = []
        for label in arms:
            row = by_case[label].get(case, {"missing": True})
            if row.get("missing"):
                cells.append("missing")
            else:
                seconds = round(row["durationMs"] / 1000) if row.get("durationMs") is not None else "?"
                cells.append(f"{row['specErrors']}/{row['specCalls']} {seconds}s ok={row['correct']}")
        print(f"{case:10} | " + " | ".join(f"{cell:34}" for cell in cells))
