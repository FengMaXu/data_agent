import json,pathlib,subprocess,os
ROOT=pathlib.Path('evaluations/spider2/adr0007/independent-recompute-35')
def save(id,name,data):
 p=ROOT/'cases'/id/name;p.write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding='utf8');return p
def run(id,op,data=None,name=None):
 args=['node',str(ROOT/'answering_bridge.mjs'),id,op]
 if data is not None: args.append(str(save(id,name or (op+'-input.json'),data)))
 p=subprocess.run(args,capture_output=True,text=True,encoding='utf8'); (ROOT/'cases'/id/(name or op+'-input.json')).with_suffix('.response.json').write_text(p.stdout or p.stderr,encoding='utf8')
 if p.returncode: raise RuntimeError(p.stderr or p.stdout)
 x=json.loads(p.stdout)
 if x.get('details',{}).get('obstacle'): raise RuntimeError(json.dumps(x['details']['obstacle'],ensure_ascii=False))
 if op=='query': print(id,name,x.get('details',{}).get('preview',x))
 elif op=='set': print(id,op,x.get('content'))
 elif op=='final': print(id,op,x.get('authorizedCsv',x))
 else: print(id,op,'OK')
 return x
def progress(id,stage):
 p=ROOT/'lanes/B/progress.json';d=json.loads(p.read_text());d['cases'][id]=stage;p.write_text(json.dumps(d,ensure_ascii=False,indent=2),encoding='utf8')
def assumed(v,r='独立题解；题目未明确，作为假定披露'):return {'value':v,'basis':'assumed','rationale':r}
def req(v,q):return {'value':v,'basis':'request','quote':q}
def compare(id):
 p=subprocess.run(['python',str(ROOT/'compare_csv.py'),id],capture_output=True,text=True,encoding='utf8',env={**os.environ,'PYTHONIOENCODING':'utf-8'});print(p.stdout,p.stderr)
 if p.returncode:raise RuntimeError(p.stderr)
 return p.stdout
