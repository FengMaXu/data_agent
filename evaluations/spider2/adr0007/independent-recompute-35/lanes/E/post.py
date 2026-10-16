import json,pathlib,csv,io
from run import *
def extract(id):
 d=json.loads((ROOT/'cases'/id/'comparison-input.json').read_text(encoding='utf8'));t=json.loads(pathlib.Path(d['registry']['trace_file']).read_text(encoding='utf8'))
 s=[{'pointer':f'/toolCalls/{i}','call':v} for i,v in enumerate(t['toolCalls']) if v.get('toolName')=='set_answer_spec'];save(id,'original-spec-extract.json',s)
 fs=[]
 for x in s:
  r=x['call'].get('result',{}).get('details',{});
  if r.get('fields'):fs=r['fields']
 save(id,'original-final-fields.json',fs)
 print('SQL:',d['originalSql']);print('Fields:',json.dumps(fs,ensure_ascii=False));return d

def report(id,status,summary,fork,layer,visibility,score,body,limitations,evidence):
 save(id,'analysis.json',{'instance_id':id,'status':status,'summary':summary,'fork_node':fork,'error_layer':layer,'visibility':visibility,'independent_score':score,'evidence':evidence,'limitations':limitations})
 save(id,'analysis.md',body);progress(id,'completed',status)
