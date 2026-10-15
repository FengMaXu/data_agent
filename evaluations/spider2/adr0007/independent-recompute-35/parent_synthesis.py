"""Parent-owned synthesis of the completed real database investigations."""
import json
from pathlib import Path
HERE=Path(__file__).resolve().parent
ids=(HERE/'case-ids.txt').read_text(encoding='utf8').split()
ambiguous_mechanism={'local037','local050','local056','local061','local067','local070','local131','local168','local269','local273','local285','local335'}
paths={
'local002':('measure.formula','金额/件数、缺期及回归输入定义仍未唯一确定'),
'local010':('population.entity','业务文档明确无向城市对；原声明与SQL符合，Gold方向变体翻倍'),
'local037':('measure.countGrain','支付事件与支付订单数，原明确事件口径；不能仅据Gold判错'),
'local040':('population.entity','明确记录一行一树，但实际6838完整重复行；实体权重前提错'),
'local049':('population.entity','Gold重复公司ID的关联行，原按公司身份去重'),
'local050':('population.eligibility','2021商品月资格没有唯一依据；月均值舍入步骤另有局部差异'),
'local056':('population.missing','先发生缺月/相邻观测解释差异，随后金额差正负/绝对值'),
'local061':('population.eligibility','仅历史成对商品月还是要求目标年可见，声明可见但意图未裁决'),
'local064':('population.missing','原要求各客户各月，但SQL月集合只来自现有交易，没有全年月份脊'),
'local067':('grouping','十分位排序方向改变余数分配与各层边界，题面未指定'),
'local070':('selection','同日唯一代表城市选法，原MIN名称与独立最小ID均为额外解释'),
'local096':('population.eligibility','Gold接受未知演员/性别NULL；原明确排除未知性别'),
'local098':('population.eligibility','Gold32585超过当前32127可识别出演者全集；原缺口规则正确'),
'local100':('population.eligibility','当前完整二跳图25698；Gold隐藏子集/历史数据机制未知'),
'local131':('population.eligibility','五个全零风格是否展示，原声明全集；标准SQL额外非零过滤'),
'local167':('population.conditions','Gold含不跨任何年末的Katie Hill；原年末资格筛选正确'),
'local168':('population.conditions','职位范围先分叉，随后具名技能/未知技能、排名并列及薪资权重'),
'local169':('population.time','周期起点、观察窗口和任期端点候选仍不能解释全部Gold'),
'local171':('population.time','Gold额外限制1917..1999年末观察窗，题面未要求；LA州锚另有歧义'),
'local196':('measure.countGrain','Gold把五笔无关联付款计成租赁；原公式/SQL计真实rental'),
'local220':('population.entity','Gold可由同名不同球员合并重现；原player身份计数正确'),
'local263':('measure.countGrain','模型/步骤仍有文字歧义，但Gold还跨step关联放大；非原已证错误'),
'local264':('population.joinMultiplicity','漏step连接639含426跨步重复；原213未出现此放大'),
'local269':('population.entity','最终包装组合是根/路径/根叶还是跨根唯一叶数量，未定义'),
'local273':('population.entity','订单行/库存/实际分配事件单位先分叉；pick百分比分母未规定'),
'local279':('measure.formula','递归补货时点/初始状态候选未唯一确定，单纯并列解释已被排除'),
'local285':('population.conditions','净退货还是sale-only先分叉，随后价格与损耗权重、利润公式'),
'local286':('population.eligibility','Gold额外卖家实际54件，违反严格>100；评分/packing定义另未裁决'),
'local297':('population.conditions','Gold重建纳入purchase，与明确deposits/withdrawals范围冲突'),
'local298':('population.eligibility','Gold遗漏本月不活跃用户的前月正余额，违反all users'),
'local299':('population.joinMultiplicity','Gold重建重复客户日行，随后31行窗口；原30日已正确'),
'local331':('population.entity','Gold多出无实际第三页访问的合成END事件'),
'local335':('population.entity','赛季车手积分归属及转队处理至少两种机制都重现Gold，未唯一裁决'),
'local354':('population.eligibility','原误把DNS/DNQ/withdrawal视为真实参赛，Gold另遗漏明确合格Farina'),
'local358':('measure.countGrain','已声明user_id却假定每物理行一用户；字段内部矛盾与SQL重复计数，参考日另未定')}
rows=[]
for id in ids:
 d=HERE/'cases'/id;a=json.loads((d/'analysis.json').read_text(encoding='utf8'));latest=json.loads((d/'parent-latest-original-spec.json').read_text(encoding='utf8'));node,why=paths[id]
 fi=next((i for i,f in enumerate(latest['last_observed_spec']['fields']) if f['path']==node),None)
 field=latest['last_observed_spec']['fields'][fi] if fi is not None else None
 evidence=None
 if field:
  source=latest['source'];base=latest['pointer']+f'/fields/{fi}'
  k='value' if 'value' in field else 'status'
  v=field.get(k);q=v if isinstance(v,str) else json.dumps(v,ensure_ascii=False)
  evidence={'source':source,'pointer':base+'/'+k,'quote':q}
 local=id in {'local040','local064','local358','local354'}
 if id=='local040':layer='口径错（物理行等同树实体的假定）';visibility='假定错';assurance='局部错误；去重能解释原全部数值差异，但独立首稿也错'
 elif id=='local064':layer='实现错（全年月份未落实）';visibility='不适用：实现层；另记population.missing未声明';assurance='局部错误；不能单独解释Gold失分，Gold交易范围另冲突'
 elif id=='local358':layer='字段内部口径矛盾及实现重复计数';visibility='假定错：一行一用户前提；并非纯SQL漂移';assurance='局部错误；Gold也按320行，评分差异还来自未定参考日'
 elif id=='local354':layer='口径错（参赛资格）＋标准局部冲突';visibility='假定错：results记录等同实际参赛';assurance='局部错误；104→103只修1人，不解释Gold仅3人'
 elif a['status']=='gold_conflict':layer='标准答案与本次输入/明确要求局部冲突';visibility='不适用：未确认原Spec语义错误';assurance='Gold差异相关节点，不冒充原系统错误节点'
 else:layer='未唯一裁决';visibility='不能标成假定错/决定错：原声明可见，不等于业务错误已证';assurance='差异机制已实测，业务意图未唯一裁决' if id in ambiguous_mechanism else '已实际计算多个候选，全部差异机制仍未唯一定位'
 row={'instance_id':id,'relevant_node':node,'node_is_confirmed_original_error':local,'explanation':why,'error_layer':layer,'visibility':visibility,'qualification':assurance,'original_node_declared':field is not None,'original_node_status':field.get('status') if field else 'undeclared','original_node_value':field.get('value') if field else None,'original_spec_evidence':evidence,'primary_status':a['status']}
 rows.append(row)
 a['parent_field_review']=row
 (d/'analysis.json').write_text(json.dumps(a,ensure_ascii=False,indent=2),encoding='utf8')
# Add a concrete but secondary document-rounding observation, not a blanket primary diagnosis.
p=HERE/'cases/local050/analysis.json';a=json.loads(p.read_text(encoding='utf8'));a['secondary_findings']=[{'status':'document_alignment_difference','node':'measure.formula','description':'任务文档要求月均值先ROUND2，原嵌套公式未声明该中间步骤，SQL只舍入最终median；局部差约0.005，不解释主体51.54。','error_layer':'口径声明遗漏/实现文档符合性差异，非全部失分根因','visibility':'节点已声明，中间舍入步骤未表达；不硬套整节点未声明'}];p.write_text(json.dumps(a,ensure_ascii=False,indent=2),encoding='utf8')
(HERE/'field-review.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2),encoding='utf8')
md='''## 重算后的结论：不能再把这35题都叫“原因不明”

35题均已实际访问数据库，保留独立题解、执行SQL、原始返回、最终Candidate/CSV/Receipt及冻结。**完成调查不等于35题都独立答对，也不等于35题都找到唯一业务定义。**

| 最终互斥分组 | 数量 | 含义 |
|---|---:|---|
| 原系统局部错误已证 | 3 | 040重复树身份/权重；064全年月份遗漏；358用户计数矛盾。是否解释全部失分逐题区分 |
| 本次Gold与明确要求或输入存在局部冲突 | 17 | 只能裁决具体冲突，不能证明原系统整题正确；354同时有原参赛资格错误 |
| 实测后业务解释仍未唯一裁决 | 15 | 其中12题已定位可复现的差异机制，3题仍未唯一恢复完整机制 |

- **12题“数值机制已找到，但不能唯一判定业务对错”**：037、050、056、061、067、070、131、168、269、273、285、335。例如067只改NTILE方向就全部恢复Gold，但题面没指定方向；070最小city_id选代表记录与Gold逐日期完全一致，但题面没规定代表规则。这不是没有分析，而是不能把标尺偏好冒充用户意图。
- **3题“实际实验后仍未完整恢复机制”**：002回归、169留存、279库存递归。已保存多个真实候选与反例，不能在没有共同解释全部值的情况下强定根因。
- **原系统可证局部问题共4题**（非互斥计数）：040、064、358，加上主要分组归Gold冲突的354。050还有中间舍入与文档的局部差异，但不足以解释主体失分，不混进整题确证计数。
- 独立初次冻结的官方分为**1/35**（070）。这是重算答案与当前Gold合同的吻合率，不是人工业务正确率，更不是字段树的新测评准确率。35题本来就是筛选的原错题。
- **独立解题自己也出错**：040冻结解未处理树/收入重复；098首稿把NULL PID合并成1个演员。两者明确披露，098保留首冻并另发布修正28698。不能因为由人工重新解题就自称权威。

### 模式一：数据身份事实要核查，声明业务键还不够

040实际690626行/683788树身份，完整重复6838行；358实际320行/30用户，生日对每用户相同。原字段已经写实体、键、计数粒度，仍存在“一行一实体”的错误前提或内部矛盾。需要键基数/完整重复检测、字段间一致性核查；不是再加一个要求填的字段就够了。040的独立解也犯同错，说明问题不是旧/新接口独有。

### 模式二：时间范围与计算支撑集合是两件事

064写全年2020不代表SQL生成12个月；只GROUP BY现有交易会丢掉8个无交易月。299需要客户日先归并再真正30个日历日，30行不能替代30天；169、279的周期/状态顺序则仍需更明确业务定义。检查点应覆盖“计算前保留哪些支撑期、补哪些缺期、在哪一步截断”，不能只看时间字段是否有值。

### 模式三：Gold可以隐藏资格、粒度或错误实现

096未知性别被计入全女；196无rental_id的5笔付款被当租赁；286只有54件的卖家被标108件并越过>100资格；331没有实际访问却多出END第三页。263/264跨step连接、299重复日与31行窗口有真实反事实重建。这些发现支持复审标准，而不是让模型学会复制放大、凭空补事件。重建只证明足以产生相同数值，**不证明Gold源码或原生成数据库版本**。

### 模式四：不少“错误”其实是已声明但未确证的解释

支付事件vs订单、十分位方向、每日代表记录、零风格资格、packing起点、百分比分母、转队积分归属，在原Spec中多数可见。业务文字没有唯一规则时，不能把Gold偏好的另一个解释统一标成“假定错”或“待定后决定错”。应记录“差异机制已定位/意图未裁决”，补业务定义，而不是为满足分类强写节点错误。

### 对字段方案的具体意义

1. **没有新增“树外”节点的确证需求。** 当前问题可以落到身份/资格/缺期、计数粒度、公式、分组、选取和输出；不能据35题证明整棵树无缺口。
2. **优先强化校验，而不是扩大字段数量**：实体键与行粒度一致性、source物理重复事实、完整日历集合、步骤/事件连接键、指定方法及内部舍入阶段。
3. **保留可见不确定性**：显式假定和未证决定不等于标准业务事实；用户不可澄清时披露，不通过试Gold数值把假定伪认证。
4. **评测先清理标尺**：17个局部Gold冲突需独立裁决，不能直接加到判对数，也不能据此断言模型17题全对。
5. **仍不能给新旧接口的因果胜负**：本轮是人工多次验证研究，不是相同模型/预算的七槽位对字段树A/B。

### 最后才做的35题字段审查

下表“相关节点”不全是确证错误节点：Gold问题标Gold相关位置，未裁决题只标候选位置；不会把它们冒充原系统最早分叉。原Spec是否声明由实际成功set返回的最终字段表核查，不从模型调用参数或思考文本推断。

| 题 | 相关节点 | 原节点状态 | 错误层/裁决 | 可见性与边界 |
|---|---|---|---|---|
'''
for r in rows:
 status=r['original_node_status'];reason=r['explanation'];md+=f"| {r['instance_id']} | `{r['relevant_node']}` | {status} | {r['error_layer']} | {reason}；{r['visibility']} |\n"
md+='''
完整原字段值及原trace精确pointer在`independent-recompute-35/field-review.json`，每条引文再次与源文件核验。局部错误层次争议（如358业务键正确但“一行一用户”假定错误）保留说明，不强叫纯SQL漂移。

### 执行与独立性限制

- 原后台部分lane因供应商usage limit停止，父Agent根据剩余盲题补做096、098、100、196、286；354由解除UTF8阻塞的原lane完成。上游工作流“complete”不等于全部case已完成，最终验收以落盘证据为准。
- 每题freeze先于其Gold reveal，最终SQL与发布CSV有真实Candidate/Receipt绑定。日志不记录所有文件读取，故不能仅凭这个时序声称严格实验盲法。061明确见过相近050的Gold重建解释，但冻结SQL没有采用2021资格；父Agent也已有历史卷宗知识。本研究是独立实现与实证复核，不是零先验受控盲评。
- 算法由人工自由题解与SQL形成，不由字段树模型重跑。当前环境的工具只作只读授权、记账和最终结果来源约束；机械登记字段不构成业务正确性的依据。外部反馈/比较建议未配置，不能声称获得机器口径背书。
- 较大探索预算、读全Schema、人工反例检验与原模型限时条件不同，不据此评价原工具效率；首次UTF8/SQL输入错误均保存为技术失败，未改数据库。
- 报告有35道完成调查的题，不再存在“没实际查数据库就结束”的题；15道意图未唯一裁决是实查后的证据边界。
'''
(HERE/'pattern-synthesis.md').write_text(md,encoding='utf8')
print('parent synthesis written',len(rows))
