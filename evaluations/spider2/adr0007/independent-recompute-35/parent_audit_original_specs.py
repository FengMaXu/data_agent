"""After independent freezes, re-read original successful Spec outputs; never queries DB."""
import json
from pathlib import Path
HERE=Path(__file__).resolve().parent
ids=(HERE/'case-ids.txt').read_text(encoding='utf8').split()
def dump(x):return x if isinstance(x,str) else json.dumps(x,ensure_ascii=False)
findings=[]
for id in ids:
 d=HERE/'cases'/id
 comp=json.loads((d/'comparison-input.json').read_text(encoding='utf8'))
 source=comp['registry']['trace_file'];trace=json.loads(Path(source).read_text(encoding='utf8-sig'.replace('utf8-sig','utf-8-sig')))
 views=[]
 for ti,c in enumerate(trace.get('toolCalls',[])):
  details=(c.get('result') or {}).get('details')
  if c.get('toolName')=='set_answer_spec' and isinstance(details,dict) and details.get('fields'):
   views.append((ti,details))
 if not views:raise RuntimeError(id+' no observed successful Spec snapshots')
 ti,latest=views[-1]
 (d/'parent-latest-original-spec.json').write_text(json.dumps({'source':source,'pointer':f'/toolCalls/{ti}/result/details','last_observed_spec':latest},ensure_ascii=False,indent=2),encoding='utf8')
 a=json.loads((d/'analysis.json').read_text(encoding='utf8'))
 for ei,e in enumerate(a['evidence']):
  if not e['source'].startswith('original-spec') and e['source']!='original-final-fields.json':continue
  q=e['quote'];hits=[]
  for fi,f in enumerate(latest['fields']):
   if 'value' in f and q in dump(f['value']):hits.append((ti,fi,'value'))
   elif q in dump(f.get('rationale','')):hits.append((ti,fi,'rationale'))
  if hits:
   it,fi,k=hits[0]
   e['original_projection_source']=e['source']
   e['source']=source;e['pointer']=f'/toolCalls/{it}/result/details/fields/{fi}/{k}';e.pop('line',None)
  else:
   findings.append({'instance_id':id,'evidence_index':ei,'quote':q,'reason':'Quote not located in latest successful Spec field values/rationale; retain existing source but inspect manually.'})
 (d/'analysis.json').write_text(json.dumps(a,ensure_ascii=False,indent=2),encoding='utf8')
(HERE/'original-spec-source-audit.json').write_text(json.dumps({'cases':len(ids),'unresolved_projection_quotes':findings},ensure_ascii=False,indent=2),encoding='utf8')
print(json.dumps(findings,ensure_ascii=False,indent=2))
