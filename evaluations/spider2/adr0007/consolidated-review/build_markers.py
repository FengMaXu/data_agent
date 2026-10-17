"""Merge61 unique cases with35 subset updates; preserve originals; no SQL or DB access."""
import json,csv
from pathlib import Path
HERE=Path(__file__).resolve().parent
BASE=HERE.parent;OLD=BASE/'fieldtree-20261010-audit';NEW=BASE/'independent-recompute-35'
old={a['instance_id']:a for a in map(json.loads,(OLD/'case-analyses.jsonl').read_text(encoding='utf8').splitlines())}
new={id:json.loads((NEW/'cases'/id/'analysis.json').read_text(encoding='utf8')) for id in (NEW/'case-ids.txt').read_text(encoding='utf8').split()}
assert len(old)==61 and len(new)==35 and set(new)<=set(old)
prior_gold={id for id,a in old.items() if a['cause_status']=='gold_conflict'}
new_gold={id for id,a in new.items() if a['status']=='gold_conflict'}
assert len(prior_gold)==14 and len(new_gold)==17 and not prior_gold&new_gold
gold=prior_gold|new_gold|{'local064'}
core={'local015','local040','local156','local228','local283','local302'}
partial={'local003','local060','local277'}
suspect={'local358'}
mixed={'local066','local064','local354'}
checks={c['instance_id']:c for c in json.loads((HERE/'gold-content-checks.json').read_text(encoding='utf8'))['checks']}
SHORT={
'local010':'任务文档要求无向城市对，实际最少箱3对；Gold6是有向两倍。',
'local049':'同公司ID被关联行重复计数：公司173/3=57.67，重复行179/3=59.67(Gold)。',
'local064':'全年每月仅deposit−withdrawal且全500客户：唯一均值差557.704，Gold363.742不符；agent也遗漏无交易月份。',
'local066':'Gold包含已取消未送达订单，违反pizzas we delivered；agent还独立忽略加/去料。',
'local073':'订单10第一披萨无定制，Gold却输出第二披萨的加/去料结果，逐行身份冲突。',
'local096':'Gold把未知演员/性别NULL影片算全女，违反no unknown/unspecified gender。',
'local098':'Gold32585超过当前32127可识别出演者全集；原正确缺口计数28698。',
'local100':'当前完整合作图二跳且非直接合作者25698，Gold15911与明确完整图要求不兼容。',
'local114':'明确订单数应为897/2357/2024/1634，Gold9/21/10/10等于代表人数，其他列一致。',
'local133':'明确至少被排名一次，Gold仍含5个零偏好风格；差值与扩大到25风格平均相容。',
'local167':'Gold含Katie Hill的CA43，但她任期不含任何12-31；有效CA42。',
'local170':'Gold含PI，但当前PI全任期女性0，不可能男女各六期都非零。',
'local171':'Gold可由未要求的1917..1999观察窗重现；合法31年末5人而Gold4，存在遗漏。',
'local194':'要求每演员Top3，Gold只给3电影；200演员不能被三片最多45人覆盖。',
'local196':'Gold五组后续次数可由付款行数−1重现，而真实租赁数不符；存在5笔rental_id NULL付款。',
'local220':'Gold姓名可由同名合并重现：3个Marcelo胜301、5个Ricardo负163；独立球员赢家不同。',
'local230':'要求Top4导演，实际有四名各2片；Gold仅3人且电影计数等价类型连接行。',
'local253':'同一个overall national平均被Gold变为随公司变化的20个值。',
'local258':'要求each bowler，Gold漏实际投球但零wicket者；其余球数/失分并未全面核验。',
'local259':'要求each player，Gold漏实际参赛/击球的McCullum/Ponting/Dravid，非未出场歧义。',
'local263':'Gold108/234超过合法模型/状态步骤计数；漏step反事实可重现三倍值，但不证明Gold源码。',
'local264':'合法同一步regression出现213；漏step反事实增加426跨步重复并重现Gold639。',
'local270':'根Pallet Mix SG内Bottle500cl两路径600+256=856>500，却被Gold漏掉。',
'local272':'产品6520需求40；Gold只拣14+12=26，违反需求守恒。',
'local275':'要求2017每月ratio>2，Gold包含实际零月产品，无法满足forall条件。',
'local286':'Gold额外卖家仅54件/4795.91，却标108件/9591.82并越过>100资格。',
'local297':'题面仅deposit/withdrawal，Gold36.4数值机制加入purchase等；明确算法结果54.2。',
'local298':'要求all users的前月正余额总额与Gold不符；排除本月不活跃者的反事实逐月重现Gold。',
'local299':'同日重复行＋31行窗口反事实精确重现Gold；其第30行仅28/29日，与明确30日要求冲突。',
'local330':'要求每页唯一会话数，Gold仅/detail一个路径且没有任何计数。',
'local331':'Gold第三页面含END7，但实际没有END页面访问；合成终止不是第三次访问。',
'local354':'Gold仅3司机，漏明确合格Farina；agent另把Bill Aston非参赛记录当两round资格。'}
assert set(SHORT)==gold and not gold&core
CORE={
'local015':('population.conditions','口径错','假定错','qualification_scope','遗漏motorcycle_collision资格，头盔标记不能代替事故总体条件。','Gold两百分比按实际motorcycle分组3/18和0/1核验；长/宽输出另有合同失配。'),
'local040':('population.entity','身份/物理前提错被写入口径','假定错','entity_duplicate_weight','6838完整重复树行被当独立树，AVG被重复实体重新加权。','实际去重复树实验逐borough重现全部Gold均值；同ID完整重复代表同树是身份推断，保留政策限制。'),
'local156':('population.conditions','口径错','题面引用错','filter_stage','首年应作为LAG计算基线、仅输出时排除，agent先删再LAG。','保留25个年度原始价格可核验Gold20个均价/同比与升序排名；输出顺序/排名方向不是题面唯一约定。'),
'local228':('output','评分输出合同失配，非业务内容错误',None,'representation_contract','正确27对球员被横铺9行；Gold采用27行长表。','离线展开原授权CSV后27条行关联完全等于Gold；业务数据并没有算错。'),
'local283':('grouping','口径错','假定错','ranking_domain','错误在season-country-league内选冠军，题意跨所有国家联赛每season选1。','从所有联赛冠军取赛季全局最大，8个身份/积分全等Gold；额外rank1列是有效但未明示输出合同。'),
'local302':('selection','口径错','误标不适用','final_selection','题面要最负属性类型，却selection=n/a，交付五类排序而非argmin。','现有授权全表最小值demographic,-2.01与Gold-2.008662在容差内；只应返回1类型。')}

def convert_old(e):
 return {'source':e['source_file'],'pointer':e.get('json_pointer',''),'record_id':e.get('record_id'),'event_sequence':e.get('event_sequence'),'quote':e['quote'],'role':e.get('role'),'supports':e.get('supports')}
def convert_new(id,e):
 p=Path(e['source']);p=p if p.is_absolute() else NEW/'cases'/id/p
 return {'source':str(p).replace('\\','/'),'pointer':e.get('pointer',''),'line':e.get('line'),'quote':e['quote'],'role':'request' if e.get('pointer')=='/question' else 'gold' if '/goldCsv/' in e.get('pointer','') else 'spec' if 'trace.json' in str(p) else 'observation','supports':'独立重算实际返回/本题原文/原成功Spec；仅支持其引用的局部结论。'}
rows=[]
for id in sorted(old):
 a=old[id];b=new.get(id);ev=[convert_old(e) for e in a['evidence']]
 if b:ev.extend(convert_new(id,e) for e in b['evidence'])
 if id=='local064':
  d=NEW/'cases'/id;fr=json.loads((d/'independent-freeze.json').read_text(encoding='utf8'));pub=d/'publications'/fr['publication']['receiptId']/'result.csv'
  ev.extend([{'source':str(d/'executor-events.jsonl').replace('\\','/'),'line':2,'pointer':'/raw/rows','quote':'557.704','role':'observation','supports':'真实全年12月净额，最高月均值557.704且其余无交易月份均值0，最低并列不影响结果。'},{'source':str(pub).replace('\\','/'),'pointer':'','quote':'2020-01-01,424,557.704,2020-05-01,0,0,557.704','role':'result','supports':'已发布并冻结的独立最终结果，不是探索拼接；确定结果与Gold363.742冲突。'}])
 if id=='local156':
  source=next(e['source_file'] for e in a['evidence'] if e['role']=='spec')
  ev.append({'source':source,'pointer':'/toolCalls/10/result/details/artifact/preview/rows','quote':'3987.63','role':'observation','supports':'原实际BTC年度聚合保留2017基线，足以离线核算Gold2018同比及后续20项值。'})
 row={'instance_id':id,'title':a['title'],'prior61_status':a['cause_status'],'recompute35_status':b['status'] if b else None,'gold_problem_confirmed':id in gold,'gold_problem_scope':'本次题面/输入下的局部冲突；不是已证Gold源码或原生成环境错误' if id in gold else None,'gold_algorithm_verified':False,'gold_validity_verified_scope':checks[id]['scope'] if id in core else None,'core_pattern_sample':id in core,'agent_error_confirmed':id in core-{'local228'} or id in partial|mixed|suspect,'agent_grading_contract_failure_confirmed':id=='local228','mixed_gold_and_agent_error':id in mixed,'gold_problem_suspected':id in suspect,'new_secondary_gold_mark':id=='local064','basis_rounds':['61卷宗审查']+(['35实际重算'] if b else []),'evidence':ev,'limitations':list(dict.fromkeys(a['limitations']+(b.get('limitations',[]) if b else [])))}
 if id in gold:
  row.update(category='GOLD_LOCAL_CONFLICT',gold_status='confirmed_local_conflict',marker='[GOLD有局部问题]'+('[AGENT也有局部错误]' if id in mixed else ''),conclusion=SHORT[id],gold_conflict_explanation=b['summary'] if id in new_gold else a['cause'] if id in prior_gold else '题面全年当月deposit-withdrawal且全500人；真实12月净额与首冻最终答案共同确定557.704，最低月份均为零，Gold363.742冲突。')
 elif id in core:
  node,layer,vis,pat,reason,scope=CORE[id]
  row.update(category='GOLD_VERIFIED_AGENT_FAILURE',gold_status='verified_relevant_content',marker='[GOLD相关内容已核验][AGENT输出合同失败]' if id=='local228' else '[GOLD相关内容已核验][AGENT业务错误]',conclusion=reason,bifurcation_node=node,error_layer=layer,visibility=vis,pattern=pat,gold_validity_verified_scope=scope,gold_check=checks[id])
 elif id in partial:
  row.update(category='AGENT_LOCAL_ERROR_GOLD_UNVERIFIED',gold_status='not_certified',marker='[AGENT局部错误已证][GOLD整题未核验]',conclusion=a['cause'],bifurcation_node=a['bifurcation_node'],error_layer=a['error_layer'],visibility=a['visibility'],pattern=a['primary_pattern'])
 elif id in suspect:
  row.update(category='GOLD_SUSPECT_AGENT_LOCAL_ERROR',gold_status='suspected_requires_identity_definition',marker='[GOLD待确认][AGENT粒度矛盾已证]',conclusion='Gold与agent都计320物理行而非30 user_id；但未有正式业务定义/PK确认人身份，Gold先保留待确认。原Spec自己承诺按user_id计数却一行一用户，已证内部矛盾。',bifurcation_node='measure.countGrain',error_layer='字段内部口径及兑现矛盾',visibility='假定错')
 else:
  row.update(category='UNRESOLVED_OR_SCORING_CONTRACT',gold_status='not_certified',marker='[GOLD未认证][不纳入确定业务错误模式]',conclusion=b['summary'] if b else a['cause'])
 rows.append(row)
assert len(rows)==61 and len(gold)==32 and len(core)==6
(HERE/'case-markers.jsonl').write_text(''.join(json.dumps(x,ensure_ascii=False)+'\n' for x in rows),encoding='utf8')
columns=['instance_id','title','marker','category','gold_status','gold_problem_confirmed','new_secondary_gold_mark','gold_problem_suspected','agent_error_confirmed','agent_grading_contract_failure_confirmed','mixed_gold_and_agent_error','core_pattern_sample','prior61_status','recompute35_status','bifurcation_node','error_layer','visibility','pattern','conclusion','gold_validity_verified_scope']
with (HERE/'case-markers.csv').open('w',encoding='utf-8-sig',newline='') as f:
 w=csv.DictWriter(f,fieldnames=columns,extrasaction='ignore');w.writeheader();w.writerows(rows)
(HERE/'confirmed-gold-problems-ids.txt').write_text('\n'.join(sorted(gold))+'\n',encoding='utf8')
(HERE/'gold-verified-agent-failures-ids.txt').write_text('\n'.join(sorted(core))+'\n',encoding='utf8')
(HERE/'gold-verified-business-errors-ids.txt').write_text('\n'.join(sorted(core-{'local228'}))+'\n',encoding='utf8')
summary={'unique_cases':61,'recompute_subset':35,'overlap':35,'prior_primary_gold_flags':14,'recompute_primary_gold_flags':17,'previous_primary_gold_union':31,'additional_secondary_gold_flag':['local064'],'confirmed_gold_local_conflict':32,'suspected_gold':['local358'],'core_gold_verified_agent_failures':sorted(core),'core_business_error_cases':sorted(core-{'local228'}),'representation_only_core_case':['local228'],'agent_error_gold_unverified':sorted(partial),'mixed_confirmed_gold_agent_error':sorted(mixed),'counts_by_category':{cat:sum(r['category']==cat for r in rows) for cat in sorted({r['category'] for r in rows})},'database_access_in_this_consolidation':False,'official_gold_or_score_modified':False}
(HERE/'summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf8')
print(json.dumps(summary,ensure_ascii=False,indent=2))
