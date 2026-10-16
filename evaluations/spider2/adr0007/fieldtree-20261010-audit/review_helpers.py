"""Read-only source citation checks for the latest-run postmortem."""
import argparse
import functools
import json
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent


def resolve(value, pointer):
    if pointer in (None, ''):
        return value
    if not pointer.startswith('/'):
        raise ValueError('JSON pointer must start with /')
    for part in pointer[1:].split('/'):
        part = part.replace('~1', '/').replace('~0', '~')
        value = value[int(part)] if isinstance(value, list) else value[part]
    return value


@functools.lru_cache(maxsize=8)
def source(file):
    path = Path(file)
    text = path.read_text(encoding='utf-8-sig')
    if path.suffix == '.json':
        return json.loads(text)
    if path.suffix == '.jsonl':
        return [json.loads(l) for l in text.splitlines() if l.strip()]
    return text


def check_quote(e):
    if e.get('event_sequence') is not None:
        with Path(e['source_file']).open(encoding='utf-8-sig') as f:
            value = next(x for x in (json.loads(line) for line in f if line.strip()) if x.get('sequence') == e['event_sequence'])
    else:
        value = source(e['source_file'])
    if e.get('record_id'):
        value = next(x for x in value if x.get('instanceId', x.get('instance_id')) == e['record_id'])
    value = resolve(value, e.get('json_pointer'))
    text = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)
    quote = e['quote']
    if not isinstance(quote, str) or not quote or quote not in text:
        return f'Quote absent at {e["source_file"]} {e.get("json_pointer")}: {quote!r}'
    if not e.get('supports'):
        return 'Citation missing supports explanation'
    return None


def validate(records, expected):
    errors, quotes = [], 0
    ids = [x.get('instance_id') for x in records]
    if len(ids) != len(set(ids)):
        errors.append('Duplicate instance IDs')
    if set(ids) != set(expected):
        errors.append(f'Wrong coverage: missing={set(expected)-set(ids)}, extra={set(ids)-set(expected)}')
    registry = {x['instance_id']: x for x in json.loads((HERE / 'registry.json').read_text(encoding='utf8'))}
    patterns = {'population_scope', 'source_or_identity', 'formula_aggregation', 'count_or_join',
                'time_or_missing', 'ranking_or_ties', 'units_or_precision', 'output_values',
                'spec_sql_drift', 'spec_api_friction', 'gold_conflict', 'insufficient_evidence'}
    statuses = {'confirmed','probable','unresolved','gold_conflict'}
    nodes = {'population','population.entity','population.eligibility','population.conditions',
             'population.source','population.time','population.timeField','population.missing',
             'population.joinMultiplicity','measure','measure.formula','measure.countGrain',
             'measure.denominator','measure.window','grouping','selection','selection.ties','output','树外',None}
    layers = {'口径错','实现错','方言或数据错','标准答案有问题',None}
    visibility = {'未声明','误标不适用','题面引用错','假定错','待定后决定错',None}
    for r in records:
        ident = r.get('instance_id')
        if ident not in registry:
            continue
        if r.get('attempt_id') != registry[ident]['attempt_id']:
            errors.append(f'{ident}: wrong attempt')
        if r.get('cause_status') not in statuses:
            errors.append(f'{ident}: invalid cause status')
        if r.get('primary_pattern') not in patterns or any(p not in patterns for p in r.get('secondary_patterns',[])):
            errors.append(f'{ident}: invalid pattern')
        if r.get('bifurcation_node') not in nodes or r.get('error_layer') not in layers or r.get('visibility') not in visibility:
            errors.append(f'{ident}: invalid node/layer/visibility')
        for key in ['title','standard','actual','observed_difference','spec_handling','cause','recommendation']:
            if not isinstance(r.get(key), str) or not r[key]:
                errors.append(f'{ident}: missing/non-string {key}')
        if not isinstance(r.get('limitations'), list) or not isinstance(r.get('process_findings'), list):
            errors.append(f'{ident}: limitations/process_findings must be arrays')
        roles = {e.get('role') for e in r.get('evidence', [])}
        if not (roles & {'request','standard'}) or not {'sql','spec','result'} <= roles:
            errors.append(f'{ident}: require request/standard, sql, spec and result citations')
        for e in r.get('evidence', []):
            try:
                if '/Temp/fieldtree-' in e.get('source_file','').replace('\\\\','/'):
                    errors.append(f'{ident}: reading packets are not primary citation sources')
                error = check_quote(e)
                if error:
                    errors.append(f'{ident}: {error}')
                else:
                    quotes += 1
            except (OSError, ValueError, TypeError, KeyError, IndexError, StopIteration) as exc:
                errors.append(f'{ident}: invalid citation: {exc}: {e.get("source_file")} {e.get("json_pointer")}')
    return errors, quotes


def fenced_text(text):
    """Keep embedded source Markdown fences inside the enclosing literal quote."""
    fence = '`' * max(3, max((len(x) for x in re.findall(r'`+', text)), default=0) + 1)
    return [fence + 'text', text, fence]


def verify_sql_bindings(registry):
    run = Path(json.loads((HERE/'artifact-summary.json').read_text(encoding='utf8'))['run'])
    checked = 0
    for r in registry:
        if r['score'] is None:
            continue
        result = json.loads(Path(r['result_file']).read_text(encoding='utf8'))
        bound = result.get('finalSql', {}).get('sql')
        submitted = Path(r['sql_file']).read_text(encoding='utf-8-sig')
        cached = (run/'official_score/inputs'/r['attempt_id']/'sql'/(r['instance_id']+'.sql')).read_text(encoding='utf-8-sig')
        norm = lambda s: (s or '').strip()
        if norm(bound) != norm(submitted) or norm(cached) != norm(submitted):
            raise ValueError(f'{r["instance_id"]}: scored SQL / submitted SQL / finalSql binding differs')
        checked += 1
    return checked


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--lane',type=int)
    parser.add_argument('--merge',action='store_true')
    args = parser.parse_args()
    lanes = json.loads((HERE/'lanes.json').read_text(encoding='utf8'))
    if args.lane:
        lane=lanes[args.lane-1]
        records=[json.loads(l) for l in Path(lane['output']).read_text(encoding='utf8').splitlines() if l.strip()]
        expected=lane['ids']
    else:
        records=[json.loads(l) for lane in lanes for l in Path(lane['output']).read_text(encoding='utf8').splitlines() if l.strip()]
        expected=[ident for lane in lanes for ident in lane['ids']]
    override_path=HERE/'parent-review-overrides.json'
    if not args.lane and override_path.exists():
        index={r['instance_id']:r for r in records}
        for change in json.loads(override_path.read_text(encoding='utf8')):
            index[change['instance_id']].update(change['patch'])
    errors,n=validate(records,expected)
    if errors:
        print('\n'.join(errors))
        raise SystemExit(1)
    if args.merge:
        by_id={r['instance_id']:r for r in records}
        records=[by_id[ident] for ident in expected]
        (HERE/'case-analyses.jsonl').write_text(''.join(json.dumps(r,ensure_ascii=False)+'\n' for r in records),encoding='utf8')
    print(f'PASS: {len(records)} latest-attempt cases, {n} verbatim primary-source citations')


if __name__=='__main__':main()
