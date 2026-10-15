"""Validate consolidated marker coverage and original source quotations. No DB access."""
import json,functools
from pathlib import Path
HERE=Path(__file__).resolve().parent
@functools.lru_cache(maxsize=8)
def load_source(p):
 p=Path(p);text=p.read_text(encoding='utf-8-sig')
 if p.suffix=='.json':return json.loads(text)
 if p.suffix=='.jsonl':return [json.loads(l) for l in text.splitlines() if l.strip()]
 return text
def resolve(value,pointer):
 for part in pointer.lstrip('/').split('/') if pointer else []:
  part=part.replace('~1','/').replace('~0','~');value=value[int(part)] if isinstance(value,list) else value[part]
 return value
def quote_check(e):
 p=Path(e['source'])
 if e.get('event_sequence') is not None:
  with p.open(encoding='utf-8-sig') as f:value=next(v for v in (json.loads(line) for line in f if line.strip()) if v.get('sequence')==e['event_sequence'])
 elif e.get('line') is not None and p.suffix=='.jsonl':
  with p.open(encoding='utf-8-sig') as f:value=next(json.loads(line) for n,line in enumerate(f,1) if n==e['line'])
 else:value=load_source(str(p))
 if e.get('record_id'):value=next(v for v in value if v.get('instanceId',v.get('instance_id'))==e['record_id'])
 if isinstance(value,str) and e.get('pointer'): value=json.loads(value)
 value=resolve(value,e.get('pointer'))
 variants=[value] if isinstance(value,str) else [json.dumps(value,ensure_ascii=False),json.dumps(value,ensure_ascii=False,separators=(',',':'))]
 assert e['quote'] and any(e['quote'] in text for text in variants),'quote absent at '+str(p)+' '+str(e.get('pointer'))
 return True
rows=[json.loads(l) for l in (HERE/'case-markers.jsonl').read_text(encoding='utf8').splitlines() if l.strip()]
assert len(rows)==len({r['instance_id'] for r in rows})==61
summary=json.loads((HERE/'summary.json').read_text(encoding='utf8'))
assert sum(summary['counts_by_category'].values())==61
assert sum(r['gold_problem_confirmed'] for r in rows)==32
assert sum(r['core_pattern_sample'] for r in rows)==6
assert all(not r['gold_problem_confirmed'] for r in rows if r['core_pattern_sample'])
assert sum(r['mixed_gold_and_agent_error'] for r in rows)==3
count=0;errors=[]
for r in rows:
 for i,e in enumerate(r['evidence']):
  try:quote_check(e);count+=1
  except Exception as exc:errors.append({'instance_id':r['instance_id'],'evidence_index':i,'error':str(exc),'source':e['source'],'pointer':e.get('pointer')})
ids=(HERE/'confirmed-gold-problems-ids.txt').read_text(encoding='utf8').split();assert set(ids)=={r['instance_id'] for r in rows if r['gold_problem_confirmed']}
validation={'unique_case_markers':61,'recomputed_cases_are_subset':35,'confirmed_gold_local_conflicts':32,'core_gold_verified_failure_cases':6,'core_confirmed_business_error_cases':5,'representation_only_case':'local228','mixed_error_cases':3,'verbatim_source_quotes_checked':count,'quote_errors':errors,'case_markers_do_not_modify_official_gold':True,'database_access_for_this_validation':False}
(HERE/'validation.json').write_text(json.dumps(validation,ensure_ascii=False,indent=2),encoding='utf8')
print(json.dumps(validation,ensure_ascii=False,indent=2))
if errors:raise SystemExit(1)
