"""Check the ADR-0007 phase-2 field tree against the 135 adjudicated Spider2 spec labels."""
import collections
import json
import sys

LABELS = "D:/data_agent/evaluations/spider2/spec-quality-labels.jsonl"
rows = [json.loads(line) for line in open(LABELS, encoding="utf-8") if line.strip()]

# 1. Structural coverage: every attribute the gold specs use, mapped to a target node (None = no home).
ATTRIBUTE_NODE = {
    ("output", "rowMode"): "output", ("output", "rowCount"): "output", ("output", "columnCount"): "output",
    ("output", "columnNames"): "output", ("output", "columnRoles"): "output", ("output", "binding"): "(label metadata)",
    ("grain", "entity"): "population.entity", ("grain", "keys"): "population.entity",
    ("grain", "intermediateGrain"): "measure.aggOrder", ("grain", "finalGrain"): "grouping",
    ("grain", "underlyingEntity"): "population.entity",
    ("measure", "kind"): "measure.formula", ("measure", "expression"): "measure.formula",
    ("measure", "aggregationOrder"): "measure.aggOrder", ("measure", "entity"): "measure.countGrain",
    ("measure", "sourceGrain"): "measure.countGrain", ("measure", "numerator"): "measure.formula",
    ("measure", "denominator"): "measure.denominator",
    ("time", "grain"): "grouping", ("time", "window"): "population.time", ("time", "calculationWindow"): "population.time",
    ("time", "displayWindow"): "output", ("time", "boundary"): "population.time", ("time", "predictionWindow"): "population.time",
    ("time", "outputWindow"): "output", ("time", "rollingWindow"): "measure.window", ("time", "outputGrain"): "grouping",
    ("unit", "kind"): "measure.unit", ("unit", "units"): "measure.unit", ("unit", "scale"): "measure.unit", ("unit", "semantic"): "measure.unit",
    ("denominator", "expression"): "measure.denominator", ("denominator", "entity"): "measure.denominator",
    ("denominator", "group"): "measure.denominator", ("denominator", "year"): "measure.denominator",
    ("denominator", "population"): "measure.denominator",
    ("filters", "semanticPredicate"): "population.conditions", ("filters", "physicalMappingRequired"): "population.conditions",
    ("ranking", "role"): "selection", ("ranking", "orderBy"): "selection", ("ranking", "partitionBy"): "selection",
    ("ranking", "tiePolicy"): "selection.ties", ("ranking", "selection"): "selection", ("ranking", "n"): "selection",
    ("ranking", "kind"): "selection", ("ranking", "target"): "selection", ("ranking", "notFinalOutput"): "selection",
    ("rounding", "rule"): "measure.unit", ("rounding", "stage"): "measure.unit",
    ("joins", "sources"): "population.source", ("joins", "relationship"): "population.joinMultiplicity",
    ("joins", "physicalMappingRequired"): "population.source", ("joins", "left"): "population.source",
    ("joins", "right"): "population.source", ("joins", "key"): "population.joinMultiplicity",
    ("joins", "cardinality"): "population.joinMultiplicity", ("joins", "purpose"): "population.source",
    ("ambiguity", "question"): "(per-node candidates)", ("ambiguity", "alternatives"): "(per-node candidates)",
    ("ambiguity", "binding"): "(per-node candidates)", ("ambiguity", "reason"): "(per-node candidates)",
}

seen = collections.Counter()
unmapped = collections.Counter()
node_cases = collections.defaultdict(set)
for row in rows:
    for facet, body in row["facets"].items():
        for alternative in body.get("alternatives") or []:
            for key in alternative:
                if key == "evidenceRefs":
                    continue
                seen[(facet, key)] += 1
                node = ATTRIBUTE_NODE.get((facet, key))
                if node is None:
                    unmapped[(facet, key)] += 1
                elif not node.startswith("("):
                    node_cases[node].add(row["instanceId"])
        if facet == "filters" and (body.get("required") or body.get("forbidden")):
            node_cases["population.conditions"].add(row["instanceId"])

print("== 1. Structural coverage")
print(f"attribute kinds used by gold specs: {len(seen)}; occurrences: {sum(seen.values())}")
print(f"unmapped attribute kinds: {len(unmapped)} -> {dict(unmapped)}")
print("cases needing each target node (of 135):")
TREE = ["population.entity", "population.eligibility", "population.conditions", "population.source", "population.time",
        "population.timeField", "population.missing", "population.joinMultiplicity", "measure.formula", "measure.countGrain",
        "measure.denominator", "measure.aggOrder", "measure.window", "measure.unit", "grouping", "selection", "selection.ties", "output"]
for node in TREE:
    print(f"  {node:28} {len(node_cases.get(node, ())):3}")

# 2. Necessity rules from the ADR supplement vs what each gold spec actually carries.
COUNT = {"count", "count_distinct"}
RATIO = {"avg", "ratio", "rate", "percentage", "percentage_change", "percentage_point_difference", "median", "rolling_avg"}
ROLLING = {"rolling_avg", "cumulative_sum"}


def kinds(row):
    return {str(alternative.get("kind")) for alternative in row["facets"]["measure"].get("alternatives") or []}


def has(row, facet, key=None):
    alternatives = row["facets"][facet].get("alternatives") or []
    if key is None:
        return bool(alternatives)
    return any(alternative.get(key) for alternative in alternatives)


RULES = {
    # node: (rule fires?, gold needs it?)
    "measure.countGrain": (lambda r: bool(kinds(r) & COUNT), lambda r: has(r, "measure", "entity") or has(r, "measure", "sourceGrain") or bool(kinds(r) & COUNT)),
    "measure.denominator": (lambda r: bool(kinds(r) & RATIO), lambda r: has(r, "denominator")),
    "measure.aggOrder": (lambda r: bool(kinds(r) & RATIO), lambda r: has(r, "measure", "aggregationOrder") or has(r, "grain", "intermediateGrain")),
    "measure.unit": (lambda r: bool(kinds(r) & RATIO), lambda r: has(r, "unit") or has(r, "rounding")),
    "measure.window": (lambda r: bool(kinds(r) & ROLLING), lambda r: has(r, "time", "rollingWindow") or bool(kinds(r) & ROLLING)),
    "selection.ties": (lambda r: has(r, "ranking"), lambda r: has(r, "ranking", "tiePolicy")),
    "population.joinMultiplicity": (lambda r: has(r, "joins"), lambda r: has(r, "joins", "relationship") or has(r, "joins", "cardinality")),
}

print("\n== 2. Necessity rules vs gold (fires / needed / missed = needed but not fired / extra = fired but not needed)")
missed_cases = {}
for node, (fires, needed) in RULES.items():
    fired = {r["instanceId"] for r in rows if fires(r)}
    need = {r["instanceId"] for r in rows if needed(r)}
    missed = need - fired
    missed_cases[node] = missed
    print(f"  {node:28} fires {len(fired):3}  needed {len(need):3}  missed {len(missed):3}  extra {len(fired - need):3}")

if "-v" in sys.argv:
    by_id = {r["instanceId"]: r for r in rows}
    for node, missed in missed_cases.items():
        if not missed:
            continue
        print(f"\n-- {node} missed:")
        for case in sorted(missed)[:8]:
            print(f"   {case} kinds={sorted(kinds(by_id[case]))} | {by_id[case]['question'][:110]}")
