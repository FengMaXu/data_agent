"""Offline keyed crosschecks on existing database artifacts/published CSV. No DB access or corrected result delivery."""
import csv,json,math,io
from pathlib import Path
HERE=Path(__file__).resolve().parent
BASE=HERE.parent
OLD=BASE/'fieldtree-20261010-audit'
NEW=BASE/'independent-recompute-35'
SUITE=Path('C:/data-agent-eval/Spider2/spider2-lite')
reg={r['instance_id']:r for r in json.loads((OLD/'registry.json').read_text(encoding='utf8'))}
def read_csv(p):
 with Path(p).open(encoding='utf-8-sig',newline='') as f:return list(csv.DictReader(f))
def gold(id):return read_csv(next((SUITE/'evaluation_suite/gold/exec_result').glob(id+'*.csv')))
def close(a,b):return math.isclose(float(a),float(b),abs_tol=.01,rel_tol=0)
def trace(id):return json.loads(Path(reg[id]['trace_file']).read_text(encoding='utf8'))
def preview(t,i):
 d=t['toolCalls'][i]['result']['details'];return d.get('artifact',{}).get('preview') or d['preview']
checks=[]
# 015: recorded exploration actually enforces the motorcycle scope.
id='local015';t=trace(id);p=preview(t,20);rows={r[0]:r for r in p['rows']};values=[100*rows['used'][4]/rows['used'][2],100*rows['not_used'][4]/rows['not_used'][2]];g=list(gold(id)[0].values());assert all(close(x,y) for x,y in zip(values,g))
checks.append({'instance_id':id,'gold_content_verified':True,'scope':'two motorcycle fatality percentages; output is a valid two-value presentation','check':'Recorded scope-correct counts yield3/18*100 and0/1*100, matching both Gold values.','source':reg[id]['trace_file'],'pointer':'/toolCalls/20/result/details/artifact/preview','diagnostic_values':values,'not_a_new_published_result':True})
# 040: using existing actual dedup experiment, not accepting a matching number without identity evidence.
id='local040';file=NEW/'cases'/id/'post-distinct-tree-original.json-response.json';p=json.loads(file.read_text(encoding='utf8'))['details']['preview'];observed={r[0]:r[2] for r in p['rows']};g={r['boroname']:r['mean_income'] for r in gold(id)};assert observed.keys()==g.keys() and all(close(v,g[k]) for k,v in observed.items())
checks.append({'instance_id':id,'gold_content_verified':True,'scope':'three borough identities and tree-weighted mean income; complete duplicate tree records collapsed','check':'All three keyed Gold means match actual DISTINCT-tree experiment; identity inference and duplicate-policy limitation retained.','source':str(file).replace('\\','/'),'pointer':'/details/preview','keyed_rows_checked':3,'not_a_new_published_result':True})
# 156: first-year baseline retained in original recorded actual query; calculate documented YoY offline.
id='local156';t=trace(id);p=preview(t,10);prices={(r[0],int(r[1])):float(r[3]) for r in p['rows']};g=gold(id);maxerr=0
for r in g:
 region=r['region'];year=int(r['year_start']);value=prices[region,year];assert close(value,r['btc_dca'])
 change=100*(value/prices[region,year-1]-1);maxerr=max(maxerr,abs(change-float(r['dca_percentage_change'])));assert close(change,r['dca_percentage_change'])
 cohort=sorted((price,rr) for (rr,yy),price in prices.items() if yy==year);rank=next(i+1 for i,(_,rr) in enumerate(cohort) if rr==region);assert rank==int(r['dca_ranking'])
checks.append({'instance_id':id,'gold_content_verified':True,'scope':'20region-year prices, YoY and ascending price rank; chosen display order/rank direction is not unique wording','check':'All Gold values are supported by25 retained-baseline actual region/year prices; YoY uses rounded observed inputs within.01 tolerance.','source':reg[id]['trace_file'],'pointer':'/toolCalls/10/result/details/artifact/preview','keyed_rows_checked':20,'max_percentage_error_from_observed_rounding':maxerr,'not_a_new_published_result':True})
# 228: valid Gold content, original has the same content in a different representation.
id='local228';pred=read_csv(reg[id]['csv_file']);unpivot=[]
for r in pred:
 for k in range(1,4):unpivot.append([r['season_id'],r[f'batsman{k}_id'],r[f'batsman{k}_runs'],r[f'bowler{k}_id'],r[f'bowler{k}_wickets']])
g=[list(r.values()) for r in gold(id)];assert unpivot==g
checks.append({'instance_id':id,'gold_content_verified':True,'scope':'all27 season-position pairs; representation/score contract only, not a confirmed business-content error','check':'Diagnostic unpivot of authorized original nine-row CSV matches all27 Gold rows exactly, including row associations.','source':reg[id]['csv_file'],'gold_file':str(next((SUITE/'evaluation_suite/gold/exec_result').glob(id+'*.csv'))).replace('\\','/'),'keyed_rows_checked':27,'not_a_new_published_result':True})
# 283: global season winner must be among league winners; existing winner records suffice for this max proof.
id='local283';pred=read_csv(reg[id]['csv_file']);best={}
for r in pred:
 s=r['season'];n=int(r['total_points'])
 if s not in best or n>int(best[s]['total_points']):best[s]=r
for r in gold(id):
 b=best[r['season']];assert [b['team_name'],b['league'],b['country'],b['total_points']]==[r['team'],r['league_name'],r['country_name'],r['total_points']];assert int(r['season_rank'])==1
assert len(best)==len(gold(id))==8
checks.append({'instance_id':id,'gold_content_verified':True,'scope':'eight global season champions/points; Gold rank1 is logically valid though not explicitly requested as an output column','check':'Across recorded league leaders, season maxima match all8 Gold identities and points; global winner must be a league leader.','source':reg[id]['csv_file'],'keyed_rows_checked':8,'not_a_new_published_result':True})
# 302: the asked final object is the argmin; existing published full list contains the needed object/value.
id='local302';pred=read_csv(reg[id]['csv_file']);winner=min(pred,key=lambda r:float(r['average_percentage_change']));g=gold(id)[0];assert winner['attribute_type']==g['metric'] and close(winner['average_percentage_change'],g['avg_percent_change'])
checks.append({'instance_id':id,'gold_content_verified':True,'scope':'requested final most-negative attribute and percentage within scoring tolerance','check':'Published list argmin is demographic,-2.01 vsGold-2.008662; other four output groups cause answer-set mismatch.','source':reg[id]['csv_file'],'keyed_rows_checked':1,'not_a_new_published_result':True})
# 064: collateral Gold issue missed by prior primary-only tally. Full-year minimum is necessarily zero, whichever tied month.
id='local064';d=NEW/'cases'/id;fr=json.loads((d/'independent-freeze.json').read_text(encoding='utf8'));ind=read_csv(d/'publications'/fr['publication']['receiptId']/'result.csv');g=gold(id)
assert len(ind)==1 and close(ind[0]['difference'],557.704) and not close(list(g[0].values())[0],557.704)
monthly=json.loads((d/'executor-events.jsonl').read_text(encoding='utf8').splitlines()[1])['raw']['rows']
assert len(monthly)==12 and all(row[1:]==[0,0,0] for row in monthly[4:])
assert max(monthly,key=lambda row:row[1])[2]==557.704 and min(monthly,key=lambda row:row[1])[2]==0
checks.append({'instance_id':id,'gold_content_verified':False,'confirmed_gold_conflict':True,'scope':'monthly deposit-withdrawal flows, all500customers/all12months; minimum months are allzero','check':'Unique requested difference557.704 vsGold363.742; generated-month ties do not change zero average. Prior report already verified all customers/months and type scope.','source':str(d/'probe-variants-response.json').replace('\\','/'),'pointer':'/details/preview/rows/2','independent_publication':fr['publication']['receiptId'],'not_a_new_published_result':True})
(HERE/'gold-content-checks.json').write_text(json.dumps({'database_access':False,'new_result_published':False,'checks':checks},ensure_ascii=False,indent=2),encoding='utf8')
print(json.dumps({'core_cases_verified':len([c for c in checks if c['gold_content_verified']]),'collateral_gold_issue_confirmed':['local064'],'database_access':False},ensure_ascii=False,indent=2))
