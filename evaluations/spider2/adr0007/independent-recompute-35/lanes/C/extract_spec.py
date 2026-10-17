import pathlib,json,sys
base=pathlib.Path(__file__).resolve().parents[2];p=base/'cases'/sys.argv[1]
assert (p/'independent-freeze.json').exists()
r=json.loads((p/'comparison-input.json').read_text(encoding='utf8'))['registry'];root=pathlib.Path(r['trace_file']).parent
out=[]
longroot=pathlib.Path(chr(92)*2+'?'+chr(92)+str(root).replace('/',chr(92)))
for f in (longroot/'session').rglob('*.jsonl'):
 ff=f
 for ln,line in enumerate(ff.read_text(encoding='utf8').splitlines(),1):
  x=json.loads(line)
  for e in x if isinstance(x,list) else [x]:
   m=e.get('message',{})
   if isinstance(m,dict) and m.get('role')=='toolResult' and m.get('toolName') in ['set_answer_spec','inspect_answer']:
    d=m.get('details',{}); out.append({'source':str(f),'line':ln,'toolName':m.get('toolName'),'details':{k:d[k] for k in ['taskId','revisionId','fields','outcomes'] if k in d}})
(p/'original-spec-extract.json').write_text(json.dumps(out,ensure_ascii=False,indent=2),encoding='utf8')
for x in out: print(x['line'],json.dumps(x['details'],ensure_ascii=False)[:18000])
