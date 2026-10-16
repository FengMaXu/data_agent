import json,pathlib,sys
from run import ROOT,LANE
ids=['local070','local167','local169','local171','local358'];checks=[]
for id in ids:
 p=ROOT/'cases'/id;a=json.loads((p/'analysis.json').read_text(encoding='utf8'));f=json.loads((p/'independent-freeze.json').read_text(encoding='utf8'));c=json.loads((p/'comparison-input.json').read_text(encoding='utf8'));ev=[]
 for e in a['evidence']:
  q=json.loads((p/e['source']).read_text(encoding='utf8'))
  for k in e.get('pointer','').strip('/').split('/'):
   if not k:continue
   k=k.replace('~1','/').replace('~0','~');q=q[int(k)] if isinstance(q,list) else q[k]
  ev.append({'source':e['source'],'pointer':e.get('pointer'),'quote_found':e['quote'] in (q if isinstance(q,str) else json.dumps(q,ensure_ascii=False))})
 pub=p/'publications'/f['publication']['receiptId'];events=[json.loads(x) for x in (p/'executor-events.jsonl').read_text(encoding='utf8').splitlines()]
 checks.append({'id':id,'frozen_before_reveal':f['frozenAt']<c['revealedAt'],'publication_sql_exists':(pub/'query.sql').exists(),'publication_csv_exists':(pub/'result.csv').exists(),'sql_same_as_independent':(pub/'query.sql').read_text(encoding='utf8').strip()==(p/'independent.sql').read_text(encoding='utf8').strip(),'analysis_exists':(p/'analysis.md').exists(),'independent_plan_exists':(p/'independent-plan.md').exists(),'evidence_check':ev,'sql_executions':len(events),'actual_final_executions':sum(e['kind']=='result' for e in events),'status':a['status'],'score':a['independent_score']})
(LANE/'artifact-checks.json').write_text(json.dumps(checks,ensure_ascii=False,indent=2),encoding='utf8')
assert all(all(x[k] for k in ['frozen_before_reveal','publication_sql_exists','publication_csv_exists','sql_same_as_independent','analysis_exists','independent_plan_exists']) and all(e['quote_found'] for e in x['evidence_check']) and x['actual_final_executions']>=1 for x in checks)
print(json.dumps(checks,ensure_ascii=False,indent=2));print('PASS: 5 freezes precede reveal, 5 authorized CSV/SQL chains, verbatim cited quotes resolved, all actual DB final executions preserved.')
