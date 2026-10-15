"""Extract all confirmed agent-side findings across the61-case audit; no DB access."""
import json
from pathlib import Path
B=Path(__file__).resolve().parent.parent
OUT=B/'fieldtree-confirmed-errors-61.md'
def jsonl(p):return [json.loads(s) for s in p.read_text(encoding='utf8').splitlines() if s.strip()]
old={r['instance_id']:r for r in jsonl(B/'fieldtree-20261010-audit/case-analyses.jsonl')}
markers={r['instance_id']:r for r in jsonl(B/'consolidated-review/case-markers.jsonl')}
core={'local015','local040','local156','local283','local302'}
local={'local003','local050','local060','local064','local066','local277','local354','local358'}
layout={'local059','local228','local311','local336'}
selected=core|local|layout
gold={i for i,r in markers.items() if r['gold_problem_confirmed']}
assert len(selected)==17 and len(gold)==32
assert {i for i,r in old.items() if r['cause_status']=='confirmed'}<=selected
remaining=set(old)-selected-gold
assert len(remaining)==15
# Fields: earliest divergence, proven cause, effect, competition/assumption observation, correction boundary.
notes={
'local003':('measure.formula','把“先算每客户比率、再在客户段内平均”改为段内SUM金额/SUM订单数。前者客户等权，后者按订单数加权，不是等价公式。','两边均11行，多个段数值不符；已证聚合拓扑差异，但金额组成与段成员也有未定差异。','两套公式候选只争payment与price+freight，共同预设段级SUM/SUM；正确的客户比率→段AVG不在候选里。','修正嵌套聚合；不能宣称仅此即可恢复全部Gold。'),
'local015':('population.conditions / measure.denominator','用头盔标记替代摩托车事故资格，遗漏motorcycle_collision条件，扩大了分母。','佩戴组23事故/3死亡，实际摩托车组18/3；原13.0435%，限定资格后16.6667%，与Gold16.67%一致。未佩戴5/0应为1/0，均为0%。','成功Spec只有头盔条件，分母明确包含全组可关联事故；没有针对摩托车资格的open候选。SQL实现了不完整Spec。','先限定摩托车事故，再按头盔分组计率。长/宽布局仍是独立评分合同问题；两表交集覆盖限制需要披露。'),
'local040':('population.entity / measure.countGrain','把树表的每个物理记录当独立树；处理了收入侧ZIP重复，却没有处理树侧完整重复，造成重复实体加权。','690626行、683788个tree_id，6838条完整重复；实际去重复树实验逐borough重现Gold三个均值。原值偏差约0.499、2.276、3.292，均超过0.01。','已有“树加权还是ZIP等权”和“收入ZIP是否去重”的竞争；共同盲点是树表本身是否一行一树。entity的一行一树写成request，题面不能证明物理唯一性。','先确定树身份及重复政策，再形成唯一树集合；不能用AVG(DISTINCT income)替代实体去重。同ID完整重复是同树仍属身份推断，缺已审核版本政策；独立重算首稿也犯了此错。'),
'local050':('measure.formula（局部中间舍入步骤）','任务文档要求月均值先ROUND2，原公式没有表达该中间量化步骤，SQL只舍入最终median；最终精度不能代替中间舍入顺序。','局部差约0.005，不解释原结果与Gold主体约51.54的差距，不认定它是导致0分的充分原因。','竞争过月/商品的聚合顺序，但公式未表达月均值中间ROUND2；2021商品月资格仍无唯一依据。','补文档要求的中间步骤；不得据此把2021实际有销售资格认作已证正确。整题继续保留未裁决。'),
'local059':('output（评分布局）','输出单一整体均值，Gold要求三事业部的三行；向量长度不兼容是已证评分失配。','原1行794864.89；Gold3行，分别对应N & S、P & A、PC。','Spec选择标量输出。题面overall average与in each division的范围存在歧义，不能反向将Gold布局认证成唯一业务要求。','只确认布局不兼容；产品名称与编码粒度及Gold数值来源未定，改成三行不保证正确。'),
'local060':('measure.formula / output','Spec声明pp_difference，SQL却输出未乘100的fraction差；output的fraction声明与公式自身也矛盾。','四产品名相同，但原0.025503等比例值与Gold百分点不符；乘100仍不能恢复所有数值甚至符号。','成功公式与输出单位内部冲突；分母虽经过候选比较，也没有消除单位矛盾。','统一百分点量纲并实现；其余分母、城市筛选及Gold数字仍需核验。'),
'local064':('population.missing / 全年月份实现','题目要求2020各客户各月，SQL只从实际交易取月份，遗漏5—12月，没有落实全年月份集合。','原最高/最低月取1月和4月，差419.99；按全年且deposit−withdrawal、全500人，最低月均值0，确定差557.704。Gold363.742另有已证冲突。','原Spec声明全年，但population.missing未声明；这是缺期处理没有落到计算实现，不是已竞争并决定排除无交易月。','补全年月份；Gold也错，不能把接近363.742作为修复目标。5—12月无交易数据、最低月并列需披露；并列不改变本题零均值差。'),
'local066':('配料公式 / 加去料实现','原SQL只展开标准配方，忽略每份订单的exclusions与extras，未计算实际送达披萨的最终配料用量。','例如原Bacon9；调整加去料的已存探针Bacon12，Gold14。不能用Gold数值指导修复，因为Gold还纳入取消订单。','原主标签为Gold冲突，但已证agent独立忽略加/去料；主标签不能掩盖同题第二种错误。','按逐份披萨身份应用排除、追加及重复数量，再限定送达；保留Gold自身送达资格冲突。'),
'local156':('population.conditions的作用阶段 / measure.formula依赖','将“排除首年”解释成同比前的总体过滤；yearly→filt删除2017→LAG，破坏2018所需基线。','20行结果中5个2018同比为NULL；保留25个实际region-year价格能核验Gold20项均价/同比，例如Africa2018为92.86%。','初始引用排除首年原文，却未声明过滤阶段；最终条件为assumed。已有BTC/ETH范围竞争，两候选均排除首年，未竞争过滤阶段。公式仅年度均价，缺完整同比依赖。','先计算LAG及同比，再排除首年展示。行序与排名方向另有未唯一规定的合同问题，不把它们混作确定业务错因。'),
'local228':('output（长表/宽表）','每赛季三对球员横铺一行，而Gold每个排名配对一行，评分向量长度不同。','预测9行，Gold27行；原授权CSV离线展开后27条ID、runs、wickets及行关联完全一致。','输出粒度声明为每season一行；不是业务指标或排名算错。','这是纯表示/评分合同失配，不计为业务错误。题面没有唯一规定长/宽布局。'),
'local277':('measure.formula（指定算法）','题面要求weighted regression，最终公式及SQL却采用无显式权重的OLS。移动平均的平滑权重不是回归权重。','原460.51，Gold39.39；方法替代已证，但权重、回归对象及Gold完整计算没有核验。','公式显式假定ordinary least-squares，未以合格依据解决weighted要求。','明确权重和回归对象；不能以方便实现的OLS替代，也不能声称改成任意WLS即可恢复Gold。'),
'local283':('grouping / 排名域','将跨所有国家联赛每season选冠军，改为在season-country-league内分别选冠军，扩大最终对象集合。','预测90行联赛冠军；从现有联赛冠军按season取全局最大，8个冠军身份和积分匹配Gold。','grouping明确假定season、country、league。竞争的是strict88行/include_ties90行，两者都在错误排名域，无法得到8季答案。','区分球队积分累计粒度与冠军比较域，按season比较。题面存在联赛冠军背景读法，此处沿用既有审核的跨联赛season口径；Gold额外rank列不属于同一业务错因。'),
'local302':('selection / output','题目最终要最负的属性类型，Spec却将selection标为n/a并声明输出五行，用排序替代最终argmin选取。','预测5行首行demographic,-2.01；Gold1行demographic,-2.008662，数值差0.001338在0.01容差内，未选取导致对象集合不符。','实际竞争过unknown资格，但最终selection=n/a与output5行没有修改；SQL忠实执行错误的交付集合。','计算五类后选取最负者，另行声明并列政策；不要把已有平均公式或unknown纳入自动判作本次错因。'),
'local311':('output（缺评分列）','交付只含车队与年份，缺少Gold评分检查的combined_points数值向量。','三组身份和年份一致，但Gold检查1320/1157/1152；原同口径探索1435/1213/1152，补列仍有数值残差。','题面只问哪些车队和哪些年份，不能说缺积分列必然违反明确题意。','已证的是评分合同失配；不能认证Gold积分正确，也不能声称补列就修好整题。'),
'local336':('output（类别值表示）','把R/P/S/T代码改成描述字符串，评分按值比较，不能匹配Gold代码。这不是列名差异。','R/S/T计数对应1609/2452/3974相同；Pit原3093对Gold3075，还差18。','已证类别值表示失配，不等于业务类别划分错误。','规范表示只能消除代码差异；Pit18件残差未定位，不能宣称全部原因已找到。'),
'local354':('population.eligibility','把results记录存在视为实际参赛，将Bill Aston的非实际参赛记录算入资格，构成一名司机的误纳。','原104司机，按已调查参赛口径103；Gold仅3人并漏明确合格Farina，另有独立Gold冲突。','Spec声明participation，但将物理results记录等同参赛，未区分DNS/DNQ等非参赛情形。','按具体记录核对参赛资格，不能泛化为所有Withdrew都排除；有正圈数退出等边界。只确认Bill Aston局部差异，不声称已唯一恢复所有历史参赛语义。'),
'local358':('population.entity / measure.countGrain内部一致性','Spec指定user_id为用户键，却又假定每物理行一用户；实际COUNT(*)对320行计数，键只有30个。','已证自身实体与计数实现不一致；Gold也按320物理行。年龄参考日差异另可重现评分差异，但题面没有唯一参考日。','一行一用户为显式假定，与业务键承诺冲突；不是仅SQL漂移，也不是用户身份获得正式业务认证。','先解决实体/重复与参考日；缺正式身份定义和PK，不据原Spec反向证明Gold用户定义错。只标内部粒度矛盾。')}
assert set(notes)==selected

def esc(s):return str(s).replace('|','\\|').replace('\n',' ')
def linkcase(i):return f'[原61题卷宗](fieldtree-wrong118-20261010-analysis.md#{i})'
def latest(i):
 p=B/'independent-recompute-35/cases'/i/'analysis.json'
 return json.loads(p.read_text(encoding='utf8')) if p.exists() else None

def quote(e):
 location=f"`{e['source']}`"
 for key in ['record_id','pointer','line','event_sequence']:
  if e.get(key) is not None:location+=f" · {key}=`{e[key]}`"
 # Quotes are copied unchanged, never relabeled as new business evidence.
 text=e['quote'];return location+'\n\n```text\n'+text+'\n```\n'
md='''# 61道评分错题：已证错误与差异提取

## 1. 范围与结论

本文件从**完整61道评分错题**中提取已证的agent错误或输出失配，合并第一次61题审查与后续35题独立重算；35题是61题的子集，不是另一批题。本次仅整理既有记录，没有查询数据库、重跑模型或修改原评分。

**共提取17题：13题存在已证业务/方法/实现局部问题（包括内部口径矛盾及文档符合性差异），另4题有已证输出/评分合同失配。** 这些标签不等于17题的全部失分都已解释，也不等于13题的Gold都已认证正确。

| 提取层级 | 数量 | 题号（均为local前缀） |
|---|---:|---|
| Gold相关内容已核验、agent业务错因可定位的核心样本 | 5 | 015、040、156、283、302 |
| 已证局部问题，但Gold/其他口径或整题失分仍有边界 | 8 | 003、050、060、064、066、277、354、358 |
| 已证输出/评分合同失配，不直接视为业务内容算错 | 4 | 059、228、311、336 |
| **agent侧已证问题或差异合计（不重复）** | **17** | **以上三组互斥** |

### 为什么不能只整理前面说的5题？

原61题报告已有11题“可证差异”：003、015、059、060、156、228、277、283、302、311、336。其中7题业务/方法/实现差异，4题输出合同差异。第一次主标Gold冲突的066同时已有agent忽略加去料的独立错误。后续35题重算又补充040、050、064、354、358五题的已证局部发现。因此是 **11＋1＋5＝17题**。

前述5题是加了“Gold相关内容已核验”条件后的更窄样本，并非全部确定性错题；其中**只有040来自35题重算**，015、156、283、302均在第一轮已定位。050仍维持整题未裁决，只提取其中间舍入的局部文档符合性问题；358只确认自身粒度矛盾。

Gold另外有32题局部问题，见第5节；与17题中的064、066、354重叠。不能因Gold有问题就免除agent的独立错误，也不能把Gold问题题数加到正确数。

## 2. 错误原因总表

| 题号 | 问题层级 | 最早可定位位置 | 已证原因 | 仍需保留的边界 |
|---|---|---|---|---|
'''
for i in sorted(selected):
 node,cause,effect,competition,boundary=notes[i]
 category='业务错误（核心）' if i in core else '局部问题' if i in local else '输出/评分合同'
 md+=f'| [{i}](#{i}) | {category} | {esc(node)} | {esc(cause)} | {esc(boundary)} |\n'
md+='\n## 3. 逐题原因与证据\n\n以下原题与成功Spec/SQL片段引用自已有卷宗。观察、反事实重现和业务规则分开陈述；“未核验全部Gold”不影响记录已经证实的局部问题。\n\n'
for i in sorted(selected):
 a=old[i];r=markers[i];n=latest(i);node,cause,effect,competition,boundary=notes[i]
 category='核心业务错误：Gold相关内容已核验' if i in core else '已证局部问题：不认证整题Gold' if i in local else '已证评分合同失配：不等于业务内容错误'
 md+=f'<a id="{i}"></a>\n### {i} — {a["title"]}\n\n'
 md+=f'- **本文件分类**：{category}。\n- **原61题主标签**：`{a["cause_status"]}`；原attempt：`{a["attempt_id"]}`。\n'
 if n:md+=f'- **后续35题主标签**：`{n["status"]}`。本节只使用其中已证局部发现，不把主标签机械等同整题正确/错误。\n'
 md+=f'- **Gold状态**：`{r["gold_status"]}`。\n\n'
 request=next(e for e in r['evidence'] if e.get('role')=='request' and e.get('record_id')==i)
 md+='**原始题目**\n\n> '+request['quote'].replace('\n','\n> ')+'\n\n'
 md+=f'**错误原因**：{cause}\n\n**实际影响与核验**：{effect}\n\n**Spec与假设处理中的位置**：{competition}\n\n**修复方向及不能越过的结论边界**：{boundary}\n\n'
 md+='**依据与追溯**\n\n'+linkcase(i)+'；[两轮合并标记与原文证据](consolidated-review/case-markers.jsonl)。\n\n'
 if n:md+=f'[35题独立重算的本题分析](independent-recompute-35/cases/{i}/analysis.md)。\n\n'
 if i in core or i=='local228':md+='[Gold相关内容按键核对记录](consolidated-review/gold-content-checks.json)。\n\n'
 es=[e for e in r['evidence'] if e.get('role')=='spec' and len(e['quote'])<1800]
 # Include a targeted successful field when possible, otherwise one actual SQL/source excerpt.
 targets={'local003':'measure.formula','local015':'population.conditions','local040':'individual tree record','local050':'monthly','local060':'pp_difference','local156':'population.conditions','local277':'ordinary','local283':'grouping','local302':'selection','local358':'每行代表一名用户'}
 target=targets.get(i)
 ev=next((e for e in es if target and target in e['quote']),None)
 if not ev:ev=next(iter(es),None)
 if not ev:ev=next((e for e in r['evidence'] if e.get('role')=='sql'),None)
 if ev:md+='已保存的字段或SQL原文（完整引文定位见下）：\n\n'+quote(ev)+'\n'
 # For local050 quote business-doc evidence as available to avoid unsupported new claim.
 if i=='local050':
  doc=next((e for e in r['evidence'] if 'round' in e['quote'].lower() and ('document' in e['source'].lower() or 'blind.json' in e['source'])),None)
  if doc:md+='任务文档依据：\n\n'+quote(doc)+'\n'
md+='''## 4. 可以从这些题确定的错误模式

1. **字段齐全但要求未覆盖**：015遗漏总体资格，302遗漏最终选取；输出列或字段存在不等于完成题意。
2. **错误计算结构被写进Spec**：003改变聚合层次/权重，156改变过滤阶段，283改变排名范围；不能全部归咎SQL生成。
3. **竞争候选共享盲点**：003的候选都用段SUM/SUM；040调查收入连接与加权却漏树重复；156争币种不争阶段；283争并列不争排名范围。已比较候选不等于覆盖了正确解释。
4. **物理记录误当业务实体/事件**：040树重复、354参赛资格、358一行一用户。需要核对业务身份与实际数据形态，不能仅靠题面给物理唯一性背书。
5. **指定方法、量纲或中间步骤没有兑现**：277把加权回归换成OLS；060百分点与比例矛盾；050遗漏中间舍入。050的局部差异不足以解释主要失分。
6. **完整时间集合未实现**：064只取有交易月，遗漏全年无交易月。
7. **表示合同与业务正确性混淆**：059、228、311、336须单列。228业务内容完整吻合；其他三题仍有数值/定义残差，不能说改布局就全对。

这只是所列题的机制归纳，不是全评测分布或字段树优劣的因果结论。不从模型行为记录推断其不可见的心理原因；Ready、published、字段request/evidence状态也不构成语义正确性保证。

## 5. Gold自身已证局部问题（另列，不当成agent正确）

32题：原主标签14题＋35重算17题＋本次合并补标064。下表复用既有裁决，不重新认证Gold生成SQL或原生成环境。它们与上文agent侧问题可同时成立。

| 题号 | 与本文件agent问题重叠 | Gold局部问题 |
|---|---|---|
'''
for i in sorted(gold):md+=f'| {i} | {"是，双方均有问题" if i in selected else "否，未据此认定agent正确"} | {esc(markers[i]["conclusion"])} |\n'
md+='\n完整依据见[Gold问题与agent模式合并报告](fieldtree-gold-markers-and-agent-patterns.md#gold-list)。\n\n'
md+='## 6. 未纳入确定性原因清单的其余15题\n\n'
md+='、'.join(sorted(remaining))+'。\n\n这些题保留原有歧义、候选或未定位结论。已经重现某个数值机制，不足以证明该业务解释正确；不为凑齐61题而指定唯一错因。\n\n'
md+='''### 61题覆盖核对

- agent侧已证局部问题/输出差异：17题。
- Gold已证局部问题：32题，其中064、066、354与上组重叠3题。
- 两组之外仍未裁决：15题。
- **17＋32−3＋15＝61**。

其中“5核心＋8局部＋4输出”的分类为本文件提取视角，不覆盖历史报告主标签。原61报告中的11题“可证差异”全部被保留，没有因为Gold整题未核验而丢弃003、060、277等局部错误。

## 7. 来源与交付边界

- [首次61题报告](fieldtree-wrong118-20261010-analysis.md)及[逐题JSONL](fieldtree-20261010-audit/case-analyses.jsonl)。
- [35题独立重算报告](fieldtree-unresolved35-recompute.md)及各题真实执行、冻结、发布与事后审查记录。
- [两轮合并报告](fieldtree-gold-markers-and-agent-patterns.md)、[61题标记](consolidated-review/case-markers.jsonl)、[Gold内容核对](consolidated-review/gold-content-checks.json)。

本文件只摘录既有证据与诊断结果；不发布新的数据库结果，不改官方Gold、原提交或原分数。040保留实体/重复政策推断限制，283沿用既有跨联赛season审核口径；050、358只记录明确的局部符合性/内部一致性问题，不冒充整题业务已裁决。
'''
OUT.write_text(md,encoding='utf8')
print(OUT)
print(json.dumps({'agent_findings':len(selected),'business_core':len(core),'local_findings':len(local),'representation':len(layout),'gold_conflicts':len(gold),'overlap':len(selected&gold),'remaining':len(remaining),'all_old_confirmed_included':True},ensure_ascii=False))
