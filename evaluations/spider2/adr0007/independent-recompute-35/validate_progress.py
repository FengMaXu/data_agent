"""Validate persisted independent-solve evidence; never executes SQL."""
import json,sys
from pathlib import Path
from datetime import datetime
HERE=Path(__file__).resolve().parent
ids=(HERE/'case-ids.txt').read_text(encoding='utf8').split()
def load(p): return json.loads(p.read_text(encoding='utf-8-sig'))
def lines(p): return [json.loads(l) for l in p.read_text(encoding='utf8').splitlines() if l.strip()] if p.exists() else []
def pointer(obj,p):
    for key in p.lstrip('/').split('/') if p else []:
        key=key.replace('~1','/').replace('~0','~')
        obj=obj[int(key)] if isinstance(obj,list) else obj[key]
    return obj
rows=[]
for id in ids:
    d=HERE/'cases'/id
    tools=lines(d/'tool-events.jsonl')
    sql=lines(d/'executor-events.jsonl')
    errors=[]
    began=next((x for x in tools if x.get('tool')=='set_answer_spec' and x.get('response',{}).get('details',{}).get('taskId')),None)
    if sql and not began: errors.append('SQL without task creation evidence')
    if sql and began and sql[0]['occurredAt']<began['occurredAt']: errors.append('First SQL before Spec was established')
    frozen=load(d/'independent-freeze.json') if (d/'independent-freeze.json').exists() else None
    reveal=load(d/'comparison-input.json') if (d/'comparison-input.json').exists() else None
    comp=load(d/'csv-comparison.json') if (d/'csv-comparison.json').exists() else None
    a=load(d/'analysis.json') if (d/'analysis.json').exists() else None
    if reveal and (not frozen or reveal['revealedAt']<frozen['frozenAt']): errors.append('Gold reveal before independent freeze')
    if frozen:
        pub=frozen['publication']
        pubdir=d/'publications'/pub['receiptId']
        if not (pubdir/'result.csv').exists(): errors.append('Published CSV missing')
        if not (pubdir/'receipt.json').exists(): errors.append('Receipt file missing')
        if (pubdir/'receipt.json').exists() and load(pubdir/'receipt.json')!=pub: errors.append('Frozen receipt differs from publication receipt')
        candidates=[x for x in tools if x.get('tool')=='query_database' and x.get('args',{}).get('kind')=='result' and x.get('response',{}).get('details',{}).get('artifact',{}).get('candidateId')==pub['candidateId']]
        if not candidates: errors.append('No final query generated published Candidate')
        elif (pubdir/'query.sql').exists() and candidates[-1]['args']['sql'].strip()!=(pubdir/'query.sql').read_text(encoding='utf8').strip(): errors.append('Published SQL differs from candidate-generating SQL')
    if comp and comp['original_replayed_score']!=comp['recorded_original_score']: errors.append('Original CSV replay mismatch')
    if a:
        if a.get('instance_id')!=id: errors.append('Analysis case ID mismatch')
        for i,e in enumerate(a.get('evidence',[])):
            try:
                p=Path(e['source'])
                if not p.is_absolute(): p=d/p
                text=p.read_text(encoding='utf-8-sig')
                if 'pointer' in e:
                    obj=json.loads(text.splitlines()[int(e['line'])-1]) if p.suffix=='.jsonl' and 'line' in e else json.loads(text)
                    target=pointer(obj,e['pointer'])
                    variants=[target] if isinstance(target,str) else [json.dumps(target,ensure_ascii=False),json.dumps(target,ensure_ascii=False,separators=(',',':'))]
                else:
                    variants=[text]
                if not e.get('quote') or not any(e['quote'] in v for v in variants): errors.append(f'Evidence {i} not verbatim at source')
            except Exception as exc: errors.append(f'Evidence {i} cannot validate: {exc}')
    rows.append({'instance_id':id,'actual_sql_queries':len(sql),'spec_started':bool(began),'independent_frozen':bool(frozen),'gold_revealed':bool(reveal),'csv_compared':bool(comp),'analysis_written':bool(a),'analysis_md_written':(d/'analysis.md').exists(),'independent_official_score':comp.get('independent_official_score') if comp else None,'status':a.get('status') if a else None,'validation_errors':errors})
summary={'planned':len(ids),'actual_database_cases':sum(x['actual_sql_queries']>0 for x in rows),'sql_queries':sum(x['actual_sql_queries'] for x in rows),'frozen_cases':sum(x['independent_frozen'] for x in rows),'analyzed_cases':sum(x['analysis_written'] and x['analysis_md_written'] for x in rows),'validation_error_cases':sum(bool(x['validation_errors']) for x in rows),'cases':rows}
(HERE/'progress-validation.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf8')
print(json.dumps(summary,ensure_ascii=False,indent=2))
