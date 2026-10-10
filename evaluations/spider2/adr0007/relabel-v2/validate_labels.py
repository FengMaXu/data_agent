"""Offline, deterministic validation of relabeled dossier citations (no DB access)."""
import argparse
import collections
import csv
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
DIR = Path(__file__).resolve().parent
SOURCE = ROOT / 'evaluations/spider2/wrong118-dossiers.jsonl'
NODES = {'population', 'population.entity', 'population.eligibility',
         'population.conditions', 'population.source', 'population.time',
         'population.timeField', 'population.missing', 'population.joinMultiplicity',
         'measure', 'measure.formula', 'measure.countGrain', 'measure.denominator',
         'measure.window', 'grouping', 'selection', 'selection.ties', 'output', '树外'}
LAYERS = {'口径错', '实现错', '方言或数据错', '标准答案有问题'}
VISIBILITY = {'未声明', '误标不适用', '题面引用错', '假定错', '待定后决定错'}


def read_jsonl(path):
    return [json.loads(line) for line in path.read_text(encoding='utf-8-sig').splitlines() if line.strip()]


def resolve(obj, pointer):
    if not pointer.startswith('/'):
        raise ValueError('not an absolute JSON pointer')
    for token in pointer[1:].split('/'):
        token = token.replace('~1', '/').replace('~0', '~')
        obj = obj[int(token)] if isinstance(obj, list) else obj[token]
    return obj


def check(records, originals, complete=True):
    errors, checked = [], 0
    by_id = {x['instance_id']: x for x in originals}
    ids = [x.get('instance_id') for x in records]
    for ident, count in collections.Counter(ids).items():
        if count != 1:
            errors.append(f'{ident}: duplicate count={count}')
    if complete and set(ids) != set(by_id):
        errors.append(f'coverage missing={sorted(set(by_id)-set(ids))}, extra={sorted(set(ids)-set(by_id))}')
    for x in records:
        ident = x.get('instance_id')
        d = by_id.get(ident)
        if d is None:
            errors.append(f'{ident}: unknown dossier')
            continue
        def fail(msg):
            errors.append(f'{ident}: {msg}')
        for key in ('comparison', 'layer_reason', 'visibility_reason', 'confidence', 'limitations'):
            if key not in x:
                fail(f'missing {key}')
        status = x.get('classification_status', 'classified')
        if status not in {'classified', 'insufficient_evidence'}:
            fail('invalid classification_status')
        if status == 'insufficient_evidence':
            if any(x.get(k) is not None for k in ('bifurcation_node', 'error_layer', 'visibility')):
                fail('insufficient evidence must not invent three labels')
            if x.get('visibility_status') != 'insufficient_evidence' or x.get('confidence') != 'low':
                fail('insufficient evidence requires matching status and low confidence')
        else:
            if x.get('bifurcation_node') not in NODES:
                fail('invalid node')
            if x.get('error_layer') not in LAYERS:
                fail('invalid layer')
        if x.get('visibility') is None:
            if x.get('visibility_status') not in {'taxonomy_gap', 'insufficient_evidence'} or not x.get('visibility_reason'):
                fail('null visibility requires explicit taxonomy gap or insufficient evidence')
        elif x['visibility'] not in VISIBILITY or x.get('visibility_status') != 'classified':
            fail('invalid visibility/status')
        if x.get('confidence') not in {'high', 'medium', 'low'}:
            fail('invalid confidence')
        comp = x.get('comparison', {})
        if not all(isinstance(comp.get(k), str) and comp.get(k) for k in ('standard', 'actual', 'earliest_reason')):
            fail('comparison requires nonempty standard/actual/earliest_reason')
        if not isinstance(x.get('limitations'), list):
            fail('limitations must be an array')
        if x.get('bifurcation_node') == '树外' and not x.get('tree_out_reason'):
            fail('tree-out requires reason')
        if x.get('latest_wrong_run') != d.get('latest_wrong_run'):
            fail('wrong run provenance')
        ev = x.get('evidence', [])
        roles = {e.get('role') for e in ev}
        if not {'standard', 'sql', 'spec'} <= roles:
            fail('missing standard/sql/spec evidence')
        for e in ev:
            try:
                value = resolve(d, e['path'])
                haystack = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)
                quote = e['quote']
                if not isinstance(quote, str) or not quote or quote not in haystack:
                    fail(f'quote does not occur at {e.get("path")} ({quote!r})')
                elif not e.get('supports'):
                    fail(f'no citation explanation at {e["path"]}')
                else:
                    checked += 1
                prefixes = {'standard': ('/instruction', '/standard_semantics'),
                            'sql': ('/final_sql',),
                            'spec': ('/our_spec_and_decisions',),
                            'result': ('/gold_results', '/predicted_result')}
                if e.get('role') not in prefixes or not e['path'].startswith(prefixes[e['role']]):
                    fail(f'role/path mismatch: {e.get("role")} {e["path"]}')
            except (KeyError, IndexError, ValueError, TypeError) as exc:
                fail(f'invalid evidence pointer: {e.get("path")}: {exc}')
    return errors, checked


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--file', type=Path)
    parser.add_argument('--merge', action='store_true')
    args = parser.parse_args()
    originals = read_jsonl(SOURCE)
    records = read_jsonl(args.file) if args.file else [x for i in range(1, 7) for x in read_jsonl(DIR / f'lane-{i}-labels.jsonl')]
    overrides = []
    override_path = DIR / 'parent-audit-overrides.json'
    if not args.file and override_path.exists():
        overrides = json.loads(override_path.read_text(encoding='utf-8'))
        index = {x['instance_id']: x for x in records}
        for change in overrides:
            if change['instance_id'] not in index or not change.get('reason'):
                raise ValueError('Invalid parent audit override')
            index[change['instance_id']].update(change['patch'])
    errors, checked = check(records, originals, complete=not args.file)
    if errors:
        print('\n'.join(errors))
        raise SystemExit(1)
    if args.merge:
        lookup = {x['instance_id']: x for x in records}
        records = [dict(lookup[d['instance_id']], dossier_line=i + 1,
                        classification_status=lookup[d['instance_id']].get('classification_status', 'classified'))
                   for i, d in enumerate(originals)]
        out = DIR / 'wrong118-relabel-v2.jsonl'
        out.write_text(''.join(json.dumps(x, ensure_ascii=False) + '\n' for x in records), encoding='utf-8')
        with (DIR / 'wrong118-relabel-v2.csv').open('w', encoding='utf-8-sig', newline='') as f:
            fields = ['instance_id', 'dossier_line', 'latest_wrong_run', 'bifurcation_node', 'error_layer',
                      'visibility', 'visibility_status', 'classification_status', 'confidence', 'standard', 'actual',
                      'earliest_reason', 'layer_reason', 'visibility_reason', 'limitations', 'evidence']
            writer = csv.DictWriter(f, fieldnames=fields)
            writer.writeheader()
            for x in records:
                row = {k: x.get(k, '') for k in fields}
                row.update({k: x['comparison'].get(k, '') for k in ('standard', 'actual', 'earliest_reason')})
                row['limitations'] = '；'.join(x['limitations'])
                row['evidence'] = json.dumps(x['evidence'], ensure_ascii=False)
                writer.writerow(row)
        stats = {'rows': len(records), 'unique_ids': len(lookup), 'verbatim_citations_checked': checked,
                 'classification_status': dict(collections.Counter(x['classification_status'] for x in records)),
                 'nodes': dict(collections.Counter(x['bifurcation_node'] or '证据不足待定' for x in records)),
                 'layers': dict(collections.Counter(x['error_layer'] or '证据不足待定' for x in records)),
                 'visibility': dict(collections.Counter(x['visibility'] or ('定义缺口（未强行归类）' if x['visibility_status'] == 'taxonomy_gap' else '证据不足待定') for x in records)),
                 'taxonomy_gaps': [x['instance_id'] for x in records if x['visibility_status'] == 'taxonomy_gap'],
                 'insufficient_evidence': [x['instance_id'] for x in records if x['classification_status'] == 'insufficient_evidence'],
                 'low_confidence': [x['instance_id'] for x in records if x['confidence'] == 'low'],
                 'gold_sql_unavailable': sum(not d['standard_semantics'].get('gold_sql') for d in originals),
                 'parent_audit_overrides': [x['instance_id'] for x in overrides],
                 'validation_scope': 'coverage, allowed enums, source run, JSON pointers and verbatim quotes; not semantic correctness certification'}
        (DIR / 'validation-summary.json').write_text(json.dumps(stats, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        print(json.dumps(stats, ensure_ascii=False, indent=2))
    else:
        print(f'PASS: {len(records)} dossiers, {checked} verbatim citations')


if __name__ == '__main__':
    main()
