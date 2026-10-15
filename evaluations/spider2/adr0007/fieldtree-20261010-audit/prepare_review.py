"""Offline artifact review: bind latest attempts and replay CSV comparison only.
Never opens a database or executes solver SQL; source run remains read-only.
"""
import ast
import collections
import csv
import json
import math
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
HERE = Path(__file__).resolve().parent
RUN = Path('C:/data-agent-eval/runs/adr0007-fieldtree-wrong118-deepseek-flash-20261010')
SUITE = Path('C:/data-agent-eval/Spider2/spider2-lite')


def load(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def jsonl(path, key):
    return {x[key]: x for x in (json.loads(l) for l in path.read_text(encoding='utf-8-sig').splitlines() if l.strip())}


def table(path):
    with path.open(encoding='utf-8-sig', newline='') as f:
        rows = list(csv.reader(f))
    return {'file': str(path).replace('\\', '/'), 'rows': max(0, len(rows)-1), 'columns': rows[0] if rows else [], 'head': rows[1:7]}


def main():
    import pandas as pd
    manifest = load(RUN / 'manifest.json')
    ids = manifest['suite']['instanceIds']
    standards = jsonl(ROOT / 'evaluations/spider2/spec-quality-labels.jsonl', 'instanceId')
    dataset = jsonl(SUITE / 'spider2-lite.jsonl', 'instance_id')
    evals = jsonl(SUITE / 'evaluation_suite/gold/spider2lite_eval.jsonl', 'instance_id')
    merged, score_source, attempts = {}, {}, {}
    for filename, attempt in [('summary-attempt-001.json', 'attempt-001'), ('summary-retry.json', 'attempt-20261010-154318Z')]:
        summary = load(RUN / 'official_score' / filename)
        for ident, score in summary['execResult']['caseScores'].items():
            merged[ident] = score
            score_source[ident] = str(RUN / 'official_score' / filename).replace('\\', '/')
            attempts[ident] = attempt
    final_map = load(RUN / 'official_score/summary.json')['execResult']['caseScores']
    assert merged == final_map, 'Per-attempt scores disagree with latest merged map'
    assert set(merged) <= set(ids)
    evaluator = SUITE / 'evaluation_suite/evaluate.py'
    parsed = ast.parse(evaluator.read_text(encoding='utf8'))
    functions = [n for n in parsed.body if isinstance(n, ast.FunctionDef) and n.name in {'compare_pandas_table', 'compare_multi_pandas_table'}]
    env = {'pd': pd, 'math': math}
    exec(compile(ast.Module(body=functions, type_ignores=[]), str(evaluator), 'exec'), env)
    packet_root = Path(tempfile.mkdtemp(prefix='fieldtree-20261010-review-'))
    registry, replay_errors, replay_count = [], [], 0
    process_counts = collections.Counter()
    set_outcomes = collections.Counter()
    for ident in ids:
        case_dir = RUN / 'cases' / ident
        attempt = attempts.get(ident)
        available = sorted(p.name for p in (case_dir / 'attempts').iterdir()) if (case_dir / 'attempts').exists() else []
        if attempt is None:
            attempt = available[-1] if available else None
        adir = case_dir / 'attempts' / attempt if attempt else case_dir
        result_path, trace_path = adir / 'result.json', adir / 'trace.json'
        result = load(result_path) if result_path.exists() else {}
        trace = load(trace_path) if trace_path.exists() else {}
        sql_path = adir / 'submissions/sql' / (ident + '.sql')
        csv_path = RUN / 'official_score/inputs' / (attempt or '') / 'csv' / (ident + '.csv')
        if not csv_path.exists():
            csv_path = adir / 'submissions/csv' / (ident + '.csv')
        gold_paths = sorted((SUITE / 'evaluation_suite/gold/exec_result').glob(ident + '*.csv'))
        gold_sql_path = SUITE / 'evaluation_suite/gold/sql' / (ident + '.sql')
        replay = None
        if ident in merged and csv_path.exists():
            settings = evals[ident]
            pred = pd.read_csv(csv_path)
            gold = [pd.read_csv(g) for g in gold_paths]
            if len(gold) == 1:
                replay = env['compare_pandas_table'](pred, gold[0], settings['condition_cols'], settings['ignore_order'])
            else:
                replay = env['compare_multi_pandas_table'](pred, gold, settings['condition_cols'], settings['ignore_order'])
            replay_count += 1
            if replay != merged[ident]:
                replay_errors.append({'instance_id': ident, 'recorded': merged[ident], 'replayed': replay})
        entry = {'instance_id': ident, 'attempt_id': attempt, 'score': merged.get(ident),
                 'score_source': score_source.get(ident), 'replayed_csv_score': replay,
                 'group': 'wrong' if merged.get(ident) == 0 else 'correct' if merged.get(ident) == 1 else 'unscored',
                 'status': result.get('status', 'record_missing'), 'publication_status': result.get('publicationStatus'),
                 'duration_ms': result.get('durationMs'), 'tool_calls': result.get('toolCalls'), 'error': result.get('error'),
                 'result_file': str(result_path).replace('\\', '/'), 'trace_file': str(trace_path).replace('\\', '/'),
                 'result_exists': result_path.exists(), 'trace_exists': trace_path.exists(),
                 'sql_file': str(sql_path).replace('\\', '/'), 'csv_file': str(csv_path).replace('\\', '/'),
                 'sql_exists': sql_path.exists(), 'csv_exists': csv_path.exists(),
                 'gold_sql_file': str(gold_sql_path).replace('\\', '/') if gold_sql_path.exists() else None,
                 'process': result.get('episodeRecord', {}).get('process', {}),
                 'fanout_metrics': {k: v for k, v in result.get('fanoutMetrics', {}).items() if k != 'reports'},
                 'spec_feedback_metrics': {k: v for k, v in result.get('specFeedbackMetrics', {}).items() if k != 'reports'}}
        registry.append(entry)
        process_counts[(entry['group'], entry['status'])] += 1
        calls = []
        for index, call in enumerate(trace.get('toolCalls', [])):
            tool = call.get('toolName')
            args = call.get('args', {})
            res = call.get('result') or {}
            item = {'trace_index': index, 'sequence': call.get('sequence'), 'tool': tool,
                    'is_error': call.get('isError'), 'duration_ms': call.get('durationMs'), 'args': args}
            details = res.get('details') if isinstance(res, dict) else None
            texts = [c['text'] for c in res.get('content', []) if c.get('type') == 'text'] if isinstance(res, dict) else []
            if tool == 'set_answer_spec':
                if isinstance(details, dict):
                    item['details'] = {k: v for k, v in details.items() if k != 'specFeedback'}
                    for outcome in details.get('outcomes', []):
                        set_outcomes[(entry['group'], outcome.get('status'), outcome.get('path'), outcome.get('code'))] += 1
                else:
                    item['texts'] = texts
            elif tool == 'query_database':
                if isinstance(details, dict):
                    item['details'] = {k: v for k, v in details.items() if k in {'kind','preview','findings','coverage','fanout','attemptId'}}
                if call.get('isError') or not details:
                    item['texts'] = texts
            elif tool in {'export_query', 'publish_query_result', 'inspect_answer', 'compare_hypotheses', 'subagent'}:
                item['details'] = details
                item['texts'] = texts
            elif tool == 'read_knowledge':
                if isinstance(details, dict):
                    item['knowledge_id'] = details.get('knowledgeId')
                    if details.get('knowledgeId') not in {'semantic-guide','sql-rules'}:
                        item['details'] = details
                if call.get('isError'):
                    item['texts'] = texts
            elif tool in {'run_python','read_file'}:
                item['texts'] = texts
            elif call.get('isError'):
                item['texts'] = texts
            calls.append(item)
        if entry['group'] != 'correct':
            source_sql = sql_path.read_text(encoding='utf-8-sig') if sql_path.exists() else None
            packet = {'registry': entry, 'question': dataset[ident]['question'],
                      'external_knowledge': dataset[ident].get('external_knowledge'),
                      'standard_semantics': standards.get(ident),
                      'gold_sql': gold_sql_path.read_text(encoding='utf-8-sig') if gold_sql_path.exists() else None,
                      'submitted_sql': source_sql, 'bound_final_sql': result.get('finalSql'),
                      'predicted_csv': table(csv_path) if csv_path.exists() else None,
                      'gold_csv': [table(g) for g in gold_paths], 'evaluation_settings': evals.get(ident),
                      'calls': calls, 'source_refs': {'trace': entry['trace_file'], 'result': entry['result_file'],
                           'standard': str(ROOT / 'evaluations/spider2/spec-quality-labels.jsonl').replace('\\','/'),
                           'standard_record_id': ident, 'dataset': str(SUITE / 'spider2-lite.jsonl').replace('\\','/')}}
            (packet_root / (ident + '.json')).write_text(json.dumps(packet, ensure_ascii=False, indent=2), encoding='utf8')
    counts = collections.Counter(x['group'] for x in registry)
    info = {'run': str(RUN).replace('\\','/'), 'packet_root': str(packet_root).replace('\\','/'),
            'planned': len(ids), 'counts': dict(counts), 'submitted_score': counts['correct']/len(merged),
            'fixed_score': counts['correct']/len(ids), 'csv_replay_count': replay_count, 'replay_disagreements': replay_errors,
            'latest_statuses': {group: dict(collections.Counter(x['status'] for x in registry if x['group']==group)) for group in counts},
            'set_outcomes': [{'group': k[0], 'status': k[1], 'path': k[2], 'code': k[3], 'count': v} for k,v in set_outcomes.items()]}
    (HERE/'registry.json').write_text(json.dumps(registry,ensure_ascii=False,indent=2),encoding='utf8')
    (HERE/'artifact-summary.json').write_text(json.dumps(info,ensure_ascii=False,indent=2),encoding='utf8')
    wrong = [x['instance_id'] for x in registry if x['group']=='wrong']
    lanes = []
    for lane in range(6):
        subset=wrong[lane*len(wrong)//6:(lane+1)*len(wrong)//6]
        lanes.append({'lane':lane+1,'ids':subset,'packet_root':info['packet_root'],'output':str(HERE/f'lane-{lane+1}-analysis.jsonl').replace('\\','/')})
    (HERE/'lanes.json').write_text(json.dumps(lanes,ensure_ascii=False,indent=2),encoding='utf8')
    print(json.dumps({k:v for k,v in info.items() if k!='set_outcomes'},ensure_ascii=False,indent=2))
    print(json.dumps(lanes,ensure_ascii=False,indent=2))
    if replay_errors:
        print('WARNING: replay disagreements must be disclosed; scores not overwritten')


if __name__=='__main__':main()
