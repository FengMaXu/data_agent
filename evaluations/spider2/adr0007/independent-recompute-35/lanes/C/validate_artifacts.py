import pathlib,json,sys,csv,io
b=pathlib.Path(__file__).resolve().parents[2]
ids=['local064','local285','local297','local298','local299']; out=[]
for id in ids:
 p=b/'cases'/id; failures=[]
 for f in ['independent-plan.md','independent.sql','analysis.md','analysis.json','executor-events.jsonl','tool-events.jsonl','independent-freeze.json','comparison-input.json']:
  if not (p/f).exists() or not (p/f).stat().st_size:failures.append('missing '+f)
 a=json.loads((p/'analysis.json').read_text(encoding='utf8')); freeze=json.loads((p/'independent-freeze.json').read_text(encoding='utf8')); comparison=json.loads((p/'comparison-input.json').read_text(encoding='utf8'))
 for e in a['evidence']:
  s=p/e['source']
  if not s.exists():failures.append('source missing '+e['source']);continue
  text=s.read_text(encoding='utf8')
  if 'pointer' in e:
   try:
    v=json.loads(text)
    for k in e['pointer'].split('/')[1:]:v=v[int(k)] if isinstance(v,list) else v[k.replace('~1','/').replace('~0','~')]
    text=v if isinstance(v,str) else json.dumps(v,ensure_ascii=False)
   except Exception as ex:failures.append('invalid pointer '+e['source']+e['pointer']+': '+str(ex));continue
  if e['quote'] not in text:failures.append('nonverbatim quote '+e['source']+e.get('pointer','')+': '+e['quote'])
 published=p/'publications'/freeze['publication']['receiptId']
 for f in ['result.csv','query.sql','receipt.json']:
  if not (published/f).exists():failures.append('missing publication '+f)
 evs=[json.loads(l) for l in (p/'executor-events.jsonl').read_text(encoding='utf8').splitlines()]
 if not any(e['kind']=='result' for e in evs):failures.append('no final SQL database execution')
 freeze_time=freeze['frozenAt'];reveal_time=comparison['revealedAt']
 if reveal_time<=freeze_time:failures.append('reveal before freeze')
 results=[e for e in evs if e['kind']=='result']
 if not results or results[-1]['occurredAt']>freeze_time:failures.append('final not before freeze')
 out.append({'instance_id':id,'status':a['status'],'queries':len(evs),'final_queries':len(results),'freeze_before_reveal':reveal_time>freeze_time,'rows':len(list(csv.reader(io.StringIO((published/'result.csv').read_text(encoding='utf8')))))-1,'failures':failures})
(b/'lanes/C/artifact-validation.json').write_text(json.dumps(out,ensure_ascii=False,indent=2),encoding='utf8')
print(json.dumps(out,ensure_ascii=False,indent=2));sys.exit(bool(any(x['failures'] for x in out)))
