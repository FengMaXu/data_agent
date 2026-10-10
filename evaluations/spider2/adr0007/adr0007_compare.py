"""Compare the ADR-0007 A/B arms (legacy vs fields) from Spider2 run traces."""
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


def is_ready(details):
    return all(not details.get(key) for key in ("unresolvedFacets", "unresolvedHypotheses", "unresolvedChoices", "undeclaredDecisionPoints"))


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
            "toolCalls": result.get("toolCalls"),
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
    return {
        "arm": label,
        "cases finished": f"{len(done)}/{len(rows)}",
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
    arms = {"legacy": sys.argv[1], "fields": sys.argv[2]}
    analysed = {label: analyse(run_id) for label, run_id in arms.items()}
    summaries = [summarise(label, rows) for label, rows in analysed.items()]
    for key in summaries[0]:
        print(f"{key:36} | " + " | ".join(f"{str(summary[key]):22}" for summary in summaries))
    print()
    cases = sorted({row["case"] for rows in analysed.values() for row in rows})
    by_case = {label: {row["case"]: row for row in rows} for label, rows in analysed.items()}
    print(f"{'case':10} | {'legacy err/calls ready@ ok':30} | {'fields err/calls ready@ ok':30}")
    for case in cases:
        cells = []
        for label in arms:
            row = by_case[label].get(case, {"missing": True})
            if row.get("missing"):
                cells.append("missing")
            else:
                cells.append(f"{row['specErrors']}/{row['specCalls']} ready@{row['firstReadyTurn']} ok={row['correct']}")
        print(f"{case:10} | {cells[0]:30} | {cells[1]:30}")
