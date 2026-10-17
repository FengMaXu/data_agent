from work import *
ids=['local002','local010','local040','local049','local168'];report=[]
for id in ids:
 p=ROOT/'cases'/id;a=json.loads((p/'analysis.json').read_text(encoding='utf8'));f=json.loads((p/'independent-freeze.json').read_text(encoding='utf8'));c=json.loads((p/'comparison-input.json').read_text(encoding='utf8'));receipt=f['publication'];pub=p/'publications'/receipt['receiptId'];events=[json.loads(x) for x in (p/'executor-events.jsonl').read_text(encoding='utf8').splitlines()]
 checks={'required_artifacts':all((p/x).exists() for x in ['analysis.md','analysis.json','independent-plan.md','independent.sql','executor-events.jsonl','tool-events.jsonl','independent-freeze.json']),'receipt_csv_and_sql':(pub/'result.csv').exists() and (pub/'query.sql').exists(),'freeze_before_reveal':f['frozenAt']<c['revealedAt'],'real_result_execution':any(x['kind']=='result' for x in events)}
 if id=='local010':
  a['evidence'][1]={'source':'executor-events.jsonl','quote':'[5000,3]'};put(id,'analysis.json',a)
 quote_checks=[]
 for e in a['evidence']:
  content=(p/e['source']).read_text(encoding='utf8');q=e['quote'];ok=q in content
  if not ok and e['source'].endswith('.json'):
   obj=json.loads(content)
   if 'pointer' in e:
    for token in e['pointer'].strip('/').split('/'):
     token=token.replace('~1','/').replace('~0','~');obj=obj[int(token)] if isinstance(obj,list) else obj[token]
    ok=q in (obj if isinstance(obj,str) else json.dumps(obj,ensure_ascii=False))
  quote_checks.append(ok)
 checks['evidence_quotes_present']=all(quote_checks)
 report.append({'instance_id':id,'status':a['status'],'checks':checks,'executed_query_count':len(events),'independent_csv':str(pub/'result.csv'),'independent_score':a['independent_score']})
put_lane=ROOT/'lanes/A/validation.json';put_lane.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8');print(json.dumps(report,ensure_ascii=False,indent=2));assert all(all(x['checks'].values()) for x in report)
