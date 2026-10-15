"""Compare published independent result with original and Gold; no SQL/database execution."""
import sys,json,ast,math
from pathlib import Path
import pandas as pd
HERE=Path(__file__).resolve().parent
SUITE=Path('C:/data-agent-eval/Spider2/spider2-lite')
id=sys.argv[1]
d=HERE/'cases'/id
freeze=json.loads((d/'independent-freeze.json').read_text(encoding='utf8'))
comparison=json.loads((d/'comparison-input.json').read_text(encoding='utf8'))
receipt=freeze['publication']['receiptId']
ind=d/'publications'/receipt/'result.csv'
original=Path(comparison['registry']['csv_file'])
golds=[Path(x['path']) for x in comparison['goldCsv']]
source=(SUITE/'evaluation_suite/evaluate.py').read_text(encoding='utf8')
functions=[n for n in ast.parse(source).body if isinstance(n,ast.FunctionDef) and n.name in {'compare_pandas_table','compare_multi_pandas_table'}]
env={'pd':pd,'math':math}
exec(compile(ast.Module(body=functions,type_ignores=[]),str(SUITE/'evaluation_suite/evaluate.py'),'exec'),env)
settings=comparison['evaluationSettings']
def score(path):
    pred=pd.read_csv(path)
    gold=[pd.read_csv(p) for p in golds]
    fn=env['compare_pandas_table'] if len(gold)==1 else env['compare_multi_pandas_table']
    return fn(pred,gold[0] if len(gold)==1 else gold,settings['condition_cols'],settings['ignore_order'])
def summary(p):
    df=pd.read_csv(p)
    return {'path':str(p).replace('\\','/'),'rows':len(df),'columns':list(df.columns),'head':json.loads(df.head(8).to_json(orient='records',force_ascii=False))}
result={'instance_id':id,'independent_freeze':str(d/'independent-freeze.json').replace('\\','/'),'independent_official_score':int(score(ind)),'original_replayed_score':int(score(original)),'recorded_original_score':comparison['registry']['score'],'scorer_limitations':'Column-wise tolerance matching; ignore_order may ignore row associations; passing is not business proof.','independent':summary(ind),'original':summary(original),'golds':[summary(p) for p in golds],'evaluationSettings':settings}
(d/'csv-comparison.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf8')
print(json.dumps(result,ensure_ascii=False,indent=2))
