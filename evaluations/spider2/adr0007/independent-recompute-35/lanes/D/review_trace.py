import json,pathlib,sys
base=pathlib.Path('evaluations/spider2/adr0007/independent-recompute-35')
id=sys.argv[1];case=base/'cases'/id
c=json.loads((case/'comparison-input.json').read_text(encoding='utf8'))
t=json.loads(pathlib.Path(c['registry']['trace_file']).read_text(encoding='utf8'))
# Preserve only successful Answer Spec writes and actual final queries; no old diagnosis/labels.
found=[]
def walk(o):
 if isinstance(o,dict):
  if o.get('toolName') in ('set_answer_spec','query_database') or o.get('name') in ('set_answer_spec','query_database'):found.append(o)
  for k,v in o.items():walk(v)
 elif isinstance(o,list):
  for v in o:walk(v)
walk(t)
(case/'original-spec-review.json').write_text(json.dumps(found,ensure_ascii=False,indent=2),encoding='utf8')
print(json.dumps(found,ensure_ascii=False,indent=2)[:30000])
