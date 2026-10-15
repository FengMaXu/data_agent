import json, pathlib, subprocess
ROOT=pathlib.Path('D:/data_agent/evaluations/spider2/adr0007/independent-recompute-35')
def write(id,name,data):
 p=ROOT/'cases'/id/name;p.write_text(json.dumps(data,ensure_ascii=False,indent=2) if not isinstance(data,str) else data,encoding='utf8');return p
def run(id,op,data=None,name=None):
 args=['node',str(ROOT/'answering_bridge.mjs'),id,op]
 if data is not None:args.append(str(write(id,name or op+'-input.json',data)))
 p=subprocess.run(args,capture_output=True,text=True,encoding='utf8');write(id,(name or op)+'-response.txt',p.stdout+p.stderr)
 print(id,op, p.returncode, (p.stdout+p.stderr)[:250])
 if p.returncode:raise RuntimeError('CLI failure '+id+' '+op)
 return json.loads(p.stdout)
def begin(id,entity,quote,plan):
 write(id,'independent-plan.md',plan);return run(id,'set',{'fields':{'population.entity':{'value':entity,'basis':'request','quote':quote}}},'initial-set.json')
def query(id,sql,name='probe'):return run(id,'query',{'sql':sql,'limit':1000},name+'.json')
def finish(id,sql,eligibility,conditions,time,formula,grouping,columns,note):
 write(id,'independent.sql',sql)
 fields={'population.eligibility':eligibility,'population.conditions':conditions or 'n/a','population.time':time,'measure.formula':{'op':'custom','description':formula},'grouping':grouping,'selection':'n/a','output':{'rowMode':'full','columns':columns}}
 run(id,'set',{'fields':fields},'complete-set.json');run(id,'final',{'sql':sql},'final-input.json');run(id,'freeze',note,'freeze-note.json');run(id,'reveal')
 p=subprocess.run(['python',str(ROOT/'compare_csv.py'),id],capture_output=True,text=True,encoding='utf8');write(id,'comparison-output.txt',p.stdout+p.stderr);print(p.stdout+p.stderr)
def progress(id,status):
 p=ROOT/'lanes/G/progress.json';d=json.loads(p.read_text()) if p.exists() else {};d[id]=status;p.write_text(json.dumps(d,indent=2),encoding='utf8')
