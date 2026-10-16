import json,subprocess,os
from pathlib import Path
HERE=Path(__file__).resolve().parent
BRIDGE=HERE/'answering_bridge.mjs'
def save(id,name,obj):
 p=HERE/'cases'/id/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(obj if isinstance(obj,str) else json.dumps(obj,ensure_ascii=False,indent=2),encoding='utf8');return p
def call(id,op,name,obj=None):
 p=save(id,name+'.json',obj) if obj is not None else None
 cmd=['node',str(BRIDGE),id,op]+([str(p)] if p else [])
 r=subprocess.run(cmd,capture_output=True,text=True,encoding='utf8',env={**os.environ,'PYTHONIOENCODING':'utf-8','PYTHONUTF8':'1'})
 save(id,name+'-response.json',r.stdout or r.stderr)
 if r.returncode:raise RuntimeError(r.stderr)
 out=json.loads(r.stdout)
 detail=out.get('details',{})
 print(id,op,name, 'rows='+str(detail.get('preview',{}).get('rows')) if op=='query' else str(detail.get('outcomes',out.get('authorizedCsv',out.get('frozenAt',''))))[:500],flush=True)
 if detail.get('code'):raise RuntimeError(str(detail))
 return out
def query(id,name,sql,limit=100):
 save(id,name+'.sql',sql+'\n');return call(id,'query',name,{'sql':sql,'limit':limit})
def req(value,quote):return {'value':value,'basis':'request','quote':quote}
def assume(value):return {'value':value,'basis':'assumed','rationale':'独立解题所采用的解释，未将其冒充已审核业务定义。'}
def begin(id,entity,quote,plan):
 save(id,'independent-plan.md',plan);return call(id,'set','parent-entity',{'fields':{'population.entity':req(entity,quote)}})
def spec(id,fields):
 # Preserve existing values and disclose that revisions only serialize already derived algorithm.
 state=json.loads((HERE/'cases'/id/'answering-state.json').read_text(encoding='utf8'))
 previous=state['revisions'][-1]['fields']
 for k,v in list(fields.items()):
  if k in previous and previous[k].get('state')!='open':
   if v=='n/a':v={'value':'n/a','reason':'登记已独立推导的答案；不以字段表决定业务算法。'}
   elif isinstance(v,dict):v={**v,'reason':'登记已独立推导的答案；不以字段表决定业务算法。'}
   fields[k]=v
 out=call(id,'set','parent-complete-answer',{'fields':fields})
 if out['details']['undeclared'] or out['details']['open']:raise RuntimeError(str(out['details']))
 return out
def final_freeze(id,sql,note):
 save(id,'parent-independent.sql',sql+'\n')
 out=call(id,'final','parent-final',{'sql':sql})
 if 'publication' not in out:raise RuntimeError('No published result')
 return call(id,'freeze','parent-freeze-note',note)
def reveal(id):
 out=call(id,'reveal','parent-reveal')
 p=subprocess.run(['python',str(HERE/'compare_csv.py'),id],capture_output=True,text=True,encoding='utf8',env={**os.environ,'PYTHONIOENCODING':'utf-8'})
 if p.returncode:raise RuntimeError(p.stderr)
 save(id,'parent-score-output.json',p.stdout)
 return out
