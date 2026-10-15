"""Prepare blind task packets using only task wording, task documents and formal DDL files. No database access."""
import json
from pathlib import Path
HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[3]
SUITE=Path('C:/data-agent-eval/Spider2/spider2-lite')
AUDIT=HERE.parent/'fieldtree-20261010-audit'
analyses=[json.loads(l) for l in (AUDIT/'case-analyses.jsonl').read_text(encoding='utf8').splitlines() if l.strip()]
ids=sorted(x['instance_id'] for x in analyses if x['cause_status']=='unresolved')
assert len(ids)==35
dataset={x['instance_id']:x for x in map(json.loads,(SUITE/'spider2-lite.jsonl').read_text(encoding='utf8').splitlines())}
registry={x['instance_id']:x for x in json.loads((AUDIT/'registry.json').read_text(encoding='utf8'))}
lanes=[
 ('A','回归、距离、ZIP连接与总体计数',['local002','local010','local040','local049','local168']),
 ('B','付款计数、月度商品预测及销售报告',['local037','local050','local061','local067','local286']),
 ('C','银行时间序列、余额与批发财务',['local064','local285','local297','local298','local299']),
 ('D','电影关系图、资格条件与首次租赁',['local056','local096','local098','local100','local196']),
 ('E','任职区间、留存年、日期连续段与年龄参考日',['local070','local167','local169','local171','local358']),
 ('F','球员胜负、模型步骤粒度与F1赛季归属',['local220','local263','local264','local335','local354']),
 ('G','零值风格、包装递归、FIFO、库存状态与终止事件',['local131','local269','local273','local279','local331']),
]
assert sorted(x for _,_,ls in lanes for x in ls)==ids
board=[]
for lane,label,ls in lanes:
    target=HERE/'lanes'/lane
    target.mkdir(parents=True,exist_ok=True)
    board.append({'lane':lane,'focus':label,'ids':ls,'write_root':str(target).replace('\\','/')})
for id in ids:
    task=dataset[id]
    d=HERE/'cases'/id
    d.mkdir(parents=True,exist_ok=True)
    paths=[SUITE/'resource/databases'/f"{task['db']}.sqlite",SUITE/'resource/databases/spider2-localdb'/f"{task['db']}.sqlite"]
    db=next((p for p in paths if p.is_file()),None)
    docs={}
    names=task.get('external_knowledge') or []
    if isinstance(names,str): names=[names]
    for name in names:
        doc=SUITE/'resource/documents'/name
        if doc.exists(): docs[name]={'path':str(doc).replace('\\','/'),'content':doc.read_text(encoding='utf-8-sig')}
    schema_dir=SUITE/'resource/databases/sqlite'/task['db']
    ddls=[]
    if schema_dir.exists():
        ddls=[{'path':str(p).replace('\\','/'),'content':p.read_text(encoding='utf-8-sig')} for p in sorted(schema_dir.rglob('DDL.csv'))]
    packet={'instance_id':id,'db':task['db'],'database_path':str(db).replace('\\','/') if db else None,'question':task['question'],'task_source':str(SUITE/'spider2-lite.jsonl').replace('\\','/'),'documents':docs,'formal_ddl':ddls,'blind_packet':True,'note':'No original SQL, prior diagnosis, semantic labels, Gold SQL or Gold results. Freeze and publish independent solution before reveal.'}
    (d/'blind.json').write_text(json.dumps(packet,ensure_ascii=False,indent=2),encoding='utf8')
(HERE/'case-ids.txt').write_text('\n'.join(ids)+'\n',encoding='utf8')
(HERE/'lane-board.json').write_text(json.dumps(board,ensure_ascii=False,indent=2),encoding='utf8')
print(json.dumps({'cases':len(ids),'database_files_found':sum(json.loads((HERE/'cases'/id/'blind.json').read_text(encoding='utf8'))['database_path'] is not None for id in ids),'lanes':board},ensure_ascii=False,indent=2))
