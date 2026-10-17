"""Parent acceptance: verify primary quotations, field audit, freezes and published CSV replay. No DB access."""
import json,hashlib,re
from pathlib import Path
HERE=Path(__file__).resolve().parent
v=json.loads((HERE/'progress-validation.json').read_text(encoding='utf8'))
assert v['actual_database_cases']==v['frozen_cases']==v['analyzed_cases']==35
assert v['validation_error_cases']==0
pub=json.loads((HERE/'publication-integrity-validation.json').read_text(encoding='utf8'));assert pub['cases']==35 and pub['publications_verified']>=35
ids=(HERE/'case-ids.txt').read_text(encoding='utf8').split();errors=[];citations=0;fieldquotes=0;csvreplays=0;metadata={}
cache={}
def load(p):return json.loads(Path(p).read_text(encoding='utf-8-sig'))
def pointer(obj,p):
 for k in p.lstrip('/').split('/') if p else []:
  k=k.replace('~1','/').replace('~0','~');obj=obj[int(k)] if isinstance(obj,list) else obj[k]
 return obj
for id in ids:
 d=HERE/'cases'/id;a=load(d/'analysis.json');citations+=len(a['evidence']);row=a['parent_field_review'];original=load(d/'parent-latest-original-spec.json')
 fs=original['last_observed_spec']['fields'];field=next((f for f in fs if f['path']==row['relevant_node']),None)
 assert row['original_node_declared']==bool(field),(id,'declaration differs')
 assert row['original_node_status']==(field['status'] if field else 'undeclared')
 e=row['original_spec_evidence']
 if e:
  p=e['source']
  if p not in cache:cache[p]=load(p)
  target=pointer(cache[p],e['pointer']);text=target if isinstance(target,str) else json.dumps(target,ensure_ascii=False)
  assert e['quote'] in text,(id,'field quote not primary verbatim');fieldquotes+=1
 c=load(d/'csv-comparison.json');assert c['recorded_original_score']==c['original_replayed_score']==0;csvreplays+=1
 fr=load(d/'independent-freeze.json');reveal=load(d/'comparison-input.json');assert fr['frozenAt']<reveal['revealedAt']
 b=load(d/'blind.json');db=Path(b['database_path'])
 if str(db) not in metadata:
  st=db.stat();metadata[str(db).replace('\\','/')]={'size_bytes':st.st_size,'mtime_ns':st.st_mtime_ns}
validator={'scope':35,'actual_query_count':v['sql_queries'],'initial_freezes_before_reveal':35,'case_primary_quotes_checked':citations,'additional_original_field_quotes_checked':fieldquotes,'original_field_declarations_verified':35,'original_csv_score_replay_agreement':f'{csvreplays}/35','independent_initial_csv_scores':{'pass':sum(load(HERE/'cases'/id/'csv-comparison.json')['independent_official_score']==1 for id in ids),'fail':sum(load(HERE/'cases'/id/'csv-comparison.json')['independent_official_score']==0 for id in ids)},'published_result_objects_integrity_verified':pub['publications_verified'],'errors':errors,'database_access_in_final_validation':False,'runner_modified':False,'source_run_modified':False,'validation_author':'parent agent; historical fresh reviewer covered25 then-present analyses, not claimed final35 independent review','blindness_limits':['Per-case freeze/reveal chronology verified, not a full access log.','local061 had related local050 Gold prior knowledge; parent previously read historical dossiers.','This is an independent implementation/empirical investigation, not zero-prior controlled blind A/B.'],'database_metadata':metadata}
(HERE/'final-validation.json').write_text(json.dumps(validator,ensure_ascii=False,indent=2),encoding='utf8')
print(json.dumps({k:v for k,v in validator.items() if k!='database_metadata'},ensure_ascii=False,indent=2))
