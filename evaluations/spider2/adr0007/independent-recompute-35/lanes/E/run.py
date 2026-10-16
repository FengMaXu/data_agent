import json,subprocess,pathlib,sys
ROOT=pathlib.Path('evaluations/spider2/adr0007/independent-recompute-35'); LANE=ROOT/'lanes/E'
def save(id,name,obj):
 p=ROOT/'cases'/id/name;p.write_text(json.dumps(obj,ensure_ascii=False,indent=2) if not isinstance(obj,str) else obj,encoding='utf8');return p
def call(id,op,obj=None,name=None):
 args=['node',str(ROOT/'answering_bridge.mjs'),id,op]
 if obj is not None: args.append(str(save(id,name or op+'-input.json',obj)))
 r=subprocess.run(args,capture_output=True,text=True,encoding='utf8');save(id,(name or op)+'-response.txt',r.stdout+'\n'+r.stderr)
 if r.returncode: print(r.stdout+r.stderr);raise RuntimeError('CLI failed; notify supervisor')
 d=json.loads(r.stdout);print(op, id, 'saved response', list(d));return d
def query(id,sql,name='probe'):
 return call(id,'query',{'sql':sql,'limit':1000},name+'.json')
def progress(id,stage,status=None):
 p=LANE/'progress.json';d=json.loads(p.read_text(encoding='utf8')) if p.exists() else {};d[id]={'stage':stage,'status':status};p.write_text(json.dumps(d,ensure_ascii=False,indent=2),encoding='utf8')
def fullset(id,description,conditions,time,grouping,output,selection='n/a',ties=None,eligibility='Only observed eligible records; no fabricated missing records',quote=None):
 assumed=lambda v:{'value':v,'basis':'assumed','rationale':'Independent interpretation; see independent-plan.md. No Gold used.'}
 fields={'population.eligibility':assumed(eligibility),'population.conditions':assumed(conditions),'population.time':assumed(time),'measure.formula':assumed({'op':'custom','description':description}),'grouping':assumed(grouping),'selection':assumed(selection),'output':assumed({'rowMode':'full','columns':output})}
 if ties:fields['selection.ties']=assumed(ties)
 return call(id,'set',{'fields':fields},'full-spec.json')
def finish(id,sql,note):
 save(id,'independent.sql',sql);call(id,'final',{'sql':sql},'final-input.json');call(id,'freeze',note,'freeze-note.json');progress(id,'frozen');call(id,'reveal');r=subprocess.run([sys.executable,str(ROOT/'compare_csv.py'),id],capture_output=True,text=True,encoding='utf8');save(id,'comparison-response.txt',r.stdout+r.stderr);print(r.stdout+r.stderr);progress(id,'compared')
if __name__=='__main__':
 query(sys.argv[1],sys.argv[2],sys.argv[3] if len(sys.argv)>3 else 'probe')
