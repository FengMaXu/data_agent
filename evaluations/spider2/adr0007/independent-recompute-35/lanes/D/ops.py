import json,sys,pathlib,subprocess
BASE=pathlib.Path('evaluations/spider2/adr0007/independent-recompute-35')
def save(id,name,data):
 p=BASE/'cases'/id/name;p.write_text(json.dumps(data,ensure_ascii=False,indent=2) if not isinstance(data,str) else data,encoding='utf8');return p

def run(id,op,name,data=None):
 p=save(id,name+'.json',data) if data is not None else None
 cmd=['node',str(BASE/'answering_bridge.mjs'),id,op]+([str(p)] if p else [])
 r=subprocess.run(cmd,capture_output=True,text=True,encoding='utf8');save(id,name+'-response.json',r.stdout or r.stderr)
 print(r.stdout or r.stderr)
 if r.returncode:raise RuntimeError(r.stderr)
 return json.loads(r.stdout)
def begin(id,entity,quote,plan):
 save(id,'independent-plan.md',plan)
 return run(id,'set','01-entity',{'fields':{'population.entity':{'value':entity,'basis':'request','quote':quote}}})
def query(id,name,sql,limit=100):
 save(id,name+'.sql',sql+'\n');return run(id,'query',name,{'sql':sql,'limit':limit})
def fields(id,values):
 return run(id,'set','90-complete-answer',{'fields':values})
def finish(id,sql,note):
 save(id,'independent.sql',sql+'\n');run(id,'final','91-final',{'sql':sql});run(id,'freeze','92-freeze-note',note);return run(id,'reveal','93-reveal')
def assumed(value,rationale='独立推导所采用的解释；不是外部业务定义。'):
 return {'value':value,'basis':'assumed','rationale':rationale}
def req(value,quote):return {'value':value,'basis':'request','quote':quote}
def serialize(id,eligibility,conditions,time,formula,grouping,selection,output,extras=None):
 if isinstance(selection,dict) and isinstance(selection.get('orderBy'),list):selection={**selection,'orderBy':', '.join(x['column']+' '+x['direction'] for x in selection['orderBy'])}
 if conditions==[]:conditions='n/a'
 v={'population.eligibility':assumed(eligibility),'population.conditions':assumed(conditions),'population.time':assumed(time),'measure.formula':assumed({'op':'custom','description':formula}),'grouping':assumed(grouping),'selection':assumed(selection),'output':assumed(output)}
 if selection!='n/a':v['selection.ties']=assumed('include_ties')
 v.update(extras or {});return fields(id,v)
def progress(id,status,summary):
 p=BASE/'lanes'/'D'/'progress.json'
 d=json.loads(p.read_text(encoding='utf8')) if p.exists() else {'lane':'D','cases':{}}
 d['cases'][id]={'stage':status,'summary':summary};p.write_text(json.dumps(d,ensure_ascii=False,indent=2),encoding='utf8')
