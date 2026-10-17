import json, subprocess, pathlib, sys
sys.stdout.reconfigure(encoding='utf8');sys.stderr.reconfigure(encoding='utf8')
ROOT=pathlib.Path('evaluations/spider2/adr0007/independent-recompute-35')
def put(id,name,obj):
 p=ROOT/'cases'/id/name; p.write_text(json.dumps(obj,ensure_ascii=False,indent=2) if not isinstance(obj,str) else obj,encoding='utf8'); return str(p)
def run(id,op,obj=None,name=None):
 args=['node',str(ROOT/'answering_bridge.mjs'),id,op]
 if obj is not None: args.append(put(id,name or op+'-input.json',obj))
 p=subprocess.run(args,capture_output=True,text=True,encoding='utf8'); put(id,(name or op)+'-response.json',p.stdout or p.stderr)
 print(p.stdout or p.stderr)
 if p.returncode: raise RuntimeError('BRIDGE_FAILURE: '+p.stderr)
 return json.loads(p.stdout)
def init(id,entity,quote,plan):
 put(id,'independent-plan.md',plan)
 if not (ROOT/'cases'/id/'answering-state.json').exists():
  return run(id,'set',{'fields':{'population.entity':{'value':entity,'basis':'request','quote':quote}}},'entity.json')
def query(id,sql,name='explore.json',limit=100):return run(id,'query',{'sql':sql,'limit':limit},name)
def finish(id,fields,sql,note):
 run(id,'set',{'fields':fields},'complete-spec.json');put(id,'independent.sql',sql);run(id,'final',{'sql':sql},'final.json');run(id,'freeze',note,'freeze-note.json')
def reveal(id):
 run(id,'reveal');p=subprocess.run(['python',str(ROOT/'compare_csv.py'),id],capture_output=True,text=True,encoding='utf8');print(p.stdout,p.stderr);put(id,'independent-comparison.txt',p.stdout+p.stderr)
def progress(id,status):
 p=ROOT/'lanes/A/progress.json';o=json.loads(p.read_text(encoding='utf8')) if p.exists() else {};o[id]=status;p.write_text(json.dumps(o,ensure_ascii=False,indent=2),encoding='utf8')
if __name__=='__main__':pass
