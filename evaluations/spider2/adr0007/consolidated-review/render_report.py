"""Render consolidated markers and evidence-bounded patterns; no DB access."""
import json,re
from pathlib import Path
HERE=Path(__file__).resolve().parent
rows=[json.loads(l) for l in (HERE/'case-markers.jsonl').read_text(encoding='utf8').splitlines() if l.strip()]
byid={r['instance_id']:r for r in rows};summary=json.loads((HERE/'summary.json').read_text(encoding='utf8'));v=json.loads((HERE/'validation.json').read_text(encoding='utf8'))
assert not v['quote_errors'] and v['unique_case_markers']==61

def escape(s):return str(s or '—').replace('|','\\|').replace('\n',' ')
def citation(e,maxlen=500):
 q=e['quote'][:maxlen].replace('\r\n','\n')
 fence='`'*max(3,max((len(x) for x in re.findall(r'`+',q)),default=0)+1)
 where=f"`{e['source']}`"+(f"，pointer `{e['pointer']}`" if e.get('pointer') else '')+(f"，行{e['line']}" if e.get('line') else '')+(f"，记录`{e['record_id']}`" if e.get('record_id') else '')+(f"，event sequence={e['event_sequence']}" if e.get('event_sequence') is not None else '')
 return where+'：\n\n'+fence+'text\n'+q+'\n'+fence+'\n'
def is_gold(e):return '/gold/' in e['source'].replace('\\','/').lower() or '/goldCsv/' in (e.get('pointer') or '')
def selected_evidence(r):
 es=r['evidence'];request=next((e for e in es if e.get('role')=='request'),None)
 observations=[e for e in es if e.get('role') in {'result','observation'} and not is_gold(e) and ('/toolCalls/' in (e.get('pointer') or '') or 'independent-recompute' in e['source'] or 'executor-events' in e['source'])]
 proof=observations[-1] if r['instance_id']=='local064' else observations[0] if observations else next((e for e in es if e.get('role')=='result' and not is_gold(e)),None)
 gold=next((e for e in es if is_gold(e) and e.get('role') in {'gold','result'}),None)
 return [e for e in [request,proof,gold] if e]

md='''# 61道错题合并审查：Gold问题标记与data_agent错误模式

**结论：61个独立题目中，标记32题Gold局部问题；严格筛出的Gold相关内容可核验评分错题为6题，其中5题是data_agent业务错误，1题仅为输出合同失配。** 其余不能因“未发现Gold错误”就认证Gold正确。

35题是原61题的子集，本报告不是96题统计。原始Gold、评分、SQL、两份历史报告保持不变，本次新增审查标记，不重跑数据库或模型。

**交付文件**：
- [61题标记CSV](consolidated-review/case-markers.csv)：可按`gold_problem_confirmed=True`过滤；适合Excel逐题复核。
- [完整标记与原文证据JSONL](consolidated-review/case-markers.jsonl)。
- [32题Gold问题IDs](consolidated-review/confirmed-gold-problems-ids.txt)。
- [5题确定业务错误IDs](consolidated-review/gold-verified-business-errors-ids.txt)。
- [6题Gold内容可核验的评分错题IDs](consolidated-review/gold-verified-agent-failures-ids.txt)，包括仅布局失败的local228。

**导航**：[Gold问题清单](#gold-list) · [模式识别](#patterns) · [全部61题标记](#all-cases) · [原文依据](#evidence)

## 1. 合并口径与标记标准

| 互斥分类 | 题数 | 如何使用 |
|---|---:|---|
| Gold已证局部冲突 | 32 | 不作无噪声的agent错题样本；也不直接判agent正确 |
| Gold相关内容已核验、agent评分失败 | 6 | 5题业务错误用于确定性模式；1题布局单列 |
| agent局部错误已证、Gold整题未核验 | 3 | 补充机制案例，不混入Gold正确样本 |
| Gold待确认、agent局部矛盾已证 | 1 | local358：待补用户身份定义 |
| 业务未裁决或其他评分合同问题 | 19 | 不强判Gold正确，不纳入确定错误频率 |
| **合计** | **61** | 35题独立重算只更新原61题内的结论 |

“Gold有问题”始终指**本题面、本次实际数据库输入下可证的局部冲突**。没有Gold SQL或原数据库版本时，不据数值重建声称找到了Gold真实代码。它也不意味着整题所有Gold值都错。

“Gold内容已核验”是按题意和实际数据检查相关身份、值、计算规则及可用表示，不代表题面只有这一种显示顺序或布局。local228业务内容与agent完全相同，只是评分所需表示不同。

### 31变32的原因

上一轮61题主标签有14题Gold冲突；35题重算新增17题，两组无重叠，已有主标签并集31题。本次不只按主标签机械合并：**local064此前主标agent实现错误，但同题Gold也与确定题意结果冲突，应追加Gold问题标记**。

题目定义每客户每月2020的余额为当月deposit−withdrawal，并跨所有客户平均。实际500客户、12个月中，1月正余额424人且均值557.704；5—12月全部当月净额0，最低月并列无论取谁均值都0，所以差值唯一557.704。Gold363.742不符。它可被“纳入purchase且仅观测月份”重现，但**判Gold冲突靠题意下确定结果，而不是靠这个反事实数值吻合**。

local358暂不加到32：Gold和agent都把320物理行当用户，实际仅30 user_id。但未有正式业务定义/PK确证user_id对应唯一人身份；原Spec自己指定这个键，只够证明自身“一行一用户”前提矛盾。Gold用户计数标待确认；历史参考日仍不确定，不能据此认证其正确。

<a id="gold-list"></a>
## 2. 已标记的32题Gold局部问题

表中“混合”表示Gold有问题的同时，agent也有可独立确认的错误。不是自动免除agent责任。

| 题 | 来源 | 标记 | 已确认的具体问题 |
|---|---|---|---|
'''
for r in rows:
 if r['gold_problem_confirmed']:
  origin='本次补标（此前为次要结论）' if r['new_secondary_gold_mark'] else '35题实际重算' if r['recompute35_status']=='gold_conflict' else '61题原审查'
  md+=f"| [{r['instance_id']}](#e-{r['instance_id']}) | {origin} | **Gold问题＋agent错误** | {escape(r['conclusion'])} |\n" if r['mixed_gold_and_agent_error'] else f"| [{r['instance_id']}](#e-{r['instance_id']}) | {origin} | **Gold局部问题** | {escape(r['conclusion'])} |\n"
md+='''
### 必须保留的混合错误

- **local064**：Gold不是题意结果；agent自身也遗漏5—12月，不能把原419.99判正确。
- **local066**：Gold没有限定已送达；agent自身忽略披萨加料/去料，不能只改送达条件就宣称已正确。
- **local354**：Gold漏明确合格司机；agent另把未资格/退出记录当真实参赛，误纳Bill Aston，104→103只是局部修复。

32题不加入原40题正确分子，也不据`40+32`计算修正准确率。其余29题同样不自动成为Gold正确题：还必须补核验。

<a id="patterns"></a>
## 3. Gold相关内容已核验的核心样本

这些检查重新针对现有真实返回/授权CSV做了按业务键核对，不只重放官方按列比较。检查脚本和结果：[gold-content-checks.json](consolidated-review/gold-content-checks.json)、`check_gold_core.py`。诊断展开/选取不是新交付结果，未用探索或拼接数据替换原发布CSV。

| 题 | Gold为什么可用 | agent明确偏离 | 最早节点 | 层/可见性 |
|---|---|---|---|---|
'''
for r in rows:
 if r['core_pattern_sample']:
  md+=f"| {r['instance_id']} | {escape(r['gold_validity_verified_scope'])} | {escape(r['conclusion'])} | `{r['bifurcation_node']}` | {escape(r['error_layer'])}；{escape(r['visibility'])} |\n"
md+='''
### 模式A：限定条件和最终对象范围没有被完整兑现——3题

**local015、local283、local302。** 共性不是没有算数，而是回答集合偏离题意。

- 015只实现头盔条件，遗漏“motorcycle collisions”；佩戴组23个碰撞中只有18个摩托车碰撞，分母扩大，3/23→3/18。
- 283实现每联赛冠军，却不是“每season、across all countries and leagues”的全局冠军，90行→8行。讨论并列strict/include_ties只在错误排名域内调整，不能修范围。
- 302计算五类并排序已经正确，第一行就是Gold的demographic；但“最负的一类”最终选取被标n/a，5行→1行。

**字段问题**：条件、分组/排名域、最终selection都有声明或n/a，却没有逐句核验任务要求是否真正进入计算图。应核验“谁进入集合、在哪个域比较、最后返回哪些对象”，不是只检查字段齐全。

**最小回归检查**：头盔标记存在但motorcycle=0的事件必须排除；两个联赛分别100/70积分只返回全局100；两属性−2/−1只返回−2，排序全表不算完成argmin。

### 模式B：输出过滤提前破坏计算基线——1题

**local156。** 将“排除首年输出”当作LAG之前的总体过滤，2017被删除，2018同比全部NULL。实际25个region-year价格保留2017时，Gold20个均价/同比可核验；其升序排名也是这些价格的有效排名。原排名方向与显示顺序另属未唯一规定的约定，不混进这个业务错误。

**字段问题**：`population.conditions`缺少正确作用阶段；公式只登记均价ratio，没有完整同比依赖。SQL忠实执行了错误的阶段安排，不是修语法能解决。

**最小回归检查**：2017价100、2018价200，最终只显示2018，但同比必须100%，不能为NULL。先算LAG，再过滤显示年。

### 模式C：物理行被当实体，重复权重污染指标——1题

**local040。** 源树表690626行但683788个tree_id，6838行是完整重复。原只去重收入ZIP，树重复继续给均值加权；只去树完整重复即可逐borough复现全部Gold均值。独立人工首稿也犯此错，不能将其包装成模型/接口独有缺陷。

**字段问题**：实体和countGrain虽然已声明，但“一行一树”的物理前提未核查。原entity状态甚至是request，题面“树数量”并不能证明数据库行唯一。重复源行事实应由Schema/Profile检查，而不是靠题面引文给物理假定背书。相同tree_id/idx且整行相同代表同树是这里采用的身份判断，仍保留业务版本政策未审核的限制。

**最小回归检查**：同一树ID/全部字段重复两次不应多算一树；两树收入10/30，正确等树平均20，重复第一树不应变成16.67。

### 模式D：内容正确，但交付表示没有评分合同——1题，单列

**local228。** 原9行横表展开成season-position长表后，27条球员ID、runs、wickets及行关联全部等于Gold；比分、并列和配对不是错因。

这是**输出表示/评测合同失配，不是业务内容错误**。题面没有唯一规定横铺或长表，不能据Gold长表偏好反向宣称横表语义错误。若评测需要固定结构，必须提前给出合法的输出合同；不能要求模型运行时偷看Gold。

### 核心共同点

5题确定业务错误的相关节点**都可见**：015条件假定、040实体声明、156过滤声明、283分组假定、302selection不适用。SQL大多兑现了已写下的错误/不完整解释。因此本小样本优先提示的是**Spec内容及计算拓扑检查不足**，不是“再加节点”或“只优化SQL生成”。样本仅5题，不能把3/5当全评测错误分布，更不能据此比较新旧接口因果优劣。

## 4. 有价值但不得混入“Gold正确”样本的局部错误

| 题 | 已确定的agent局部问题 | 为什么不认证Gold整题正确 |
|---|---|---|
| local003 | 客户比率再段AVG被换成段SUM/SUM；候选均共享错误外层 | 金额组成price/payment/运费及段成员仍有未核验差异 |
| local060 | 声明pp_difference却输出fraction差，且字段内部单位矛盾 | 乘100仍不能解释其余符号/数值，Gold分母/城市口径未恢复 |
| local277 | 明确weighted regression被ordinary least-squares假定替换 | 具体回归对象/权重与Gold39.39未核验，不能称改WLS就完整恢复 |
| local358 | 自己声明user_id，却假定每物理行一用户并COUNT(*) | 用户身份业务定义与Gold参考日未确认，Gold320行也可疑 |
| local050 | 文档月均值ROUND2未在median前表达/实现 | 2021可见资格尚未裁决，局部舍入不能解释主体约51.54差值 |

这些局部案例提示：
- **嵌套聚合粒度**需逐层记录。两客户100/1与100/10，先客户平均为55，而段SUM/SUM约18.18；两个探针都遗漏正确外层时，比较不能救回答案。
- **量纲与字段内部一致性**需检查。份额10%→12%是2个百分点，不是0.02或20%；但本题其他数值仍需补证。
- **指定方法不能被方便方法替代**。CMA平滑权重不等于回归权重；未明确权重时应补证/披露，不能把OLS默认为已经完成加权回归。
- **中间舍入也是计算步骤**，不能只在最终output写decimals就以为内部量化顺序已完整表达。

混合错误064/066/354也可用于独立的局部回归测试，但不计入本报告“Gold正确→agent错误”的核心统计。

## 5. 仍未裁决的19题

这19题为：**002、037、050、056、059、061、067、070、131、168、169、195、269、273、279、285、311、335、336**。

- 037、050、061、067、070、131、168、269、273、285、335的差异机制已真实重建或拆解，但定义/资格/方向/分母等尚未唯一裁决。
- 056的缺月与signed/absolute解释均影响答案；195的租赁次数排名吻合Gold不等于“top actor”定义已确证。
- 059、311、336有评分/表示差异，仍有总体、数值或Pit18件残差；不能像228一样确认全部业务内容吻合。
- 002、169、279经过多个真实候选仍未恢复共同解释全部Gold的机制。

不能把它们统一当“Gold正确而agent错”，也不因未认证就统一标Gold错误。358是另列的1题Gold待确认，不在这19题中。

## 6. 下一步优先级

1. **先处理评测噪声**：将32个Gold局部问题放入复核队列；1个待确认单列。保留官方原分，不静默改Gold或把它们加成正确。
2. **补语义→计算图核验**：集合条件、排名域、最终对象、LAG/窗口支撑期及过滤阶段。五个核心业务案例各给最小反例。
3. **补物理事实与字段一致性核验**：业务键/重复行、方法权重、单位及中间舍入。声明request/assumed、Ready或已发布都不是业务正确性认证。
4. **明确输出合同**：业务内容与CSV布局分开验收。对228这类无唯一布局要求的任务，修评测契约，不把内容正确模型训练成口径错误。
5. **扩大干净样本后再做A/B**：目前只确认5个业务错误和1个合同失败，不据这些选择后的题推断字段树整体提升/劣化。

<a id="all-cases"></a>
## 7. 全部61题合并标记

| 题 | 标记 | 原61主标签 | 35重算主标签 | 核心模式样本 |
|---|---|---|---|---|
'''
for r in rows:
 md+=f"| {r['instance_id']} | {escape(r['marker'])} | {escape(r['prior61_status'])} | {escape(r['recompute35_status'])} | {'业务错误' if r['instance_id'] in summary['core_business_error_cases'] else '仅表示合同' if r['instance_id']=='local228' else '否'} |\n"
md+='''
<a id="evidence"></a>
## 8. 原文依据索引

以下展示相关原文片段，完整引文与源pointer在`case-markers.jsonl`。片段不是完整Gold集合，缺席/全集约束仍需按链接的完整文件核对；不以摘要或单个数值贴合替代原始证据。714条源引文已逐字核验，覆盖61题，校验不执行SQL。

'''
for r in rows:
 if r['gold_problem_confirmed']:
  md+=f'<a id="e-{r["instance_id"]}"></a>\n### {r["instance_id"]}：{r["conclusion"]}\n\n'
  for e in selected_evidence(r):md+=citation(e,400)+'\n'
  limits=r['limitations']
  md+='**边界**：'+('；'.join(limits[:2]) if limits else '仅限所指出的本次输入与结果局部冲突。')+'\n\n'
md+='### 核心模式的题面与成功Spec原文\n\n'
for id in summary['core_gold_verified_agent_failures']:
 r=byid[id];es=r['evidence'];node=r['bifurcation_node'];md+=f'#### {id}\n\n'
 req=next(e for e in es if e['role']=='request');md+=citation(req,500)+'\n'
 spec=[e for e in es if e['role']=='spec' and (node in e['quote'] or node in (e.get('supports') or ''))]
 if spec:md+=citation(spec[0],650)+'\n'
 elif id=='local040':
  e=next(e for e in es if e['role']=='spec' and 'individual tree record' in e['quote']);md+=citation(e,650)+'\n'
 md+='**核验范围**：'+r['gold_validity_verified_scope']+'\n\n'
md+='''
## 9. 验证与限制

- 61唯一题目、35子集关系、32确定Gold标记、6核心样本与3混合错误的集合关系均已校验。
- 原始源引文714条通过核验；Gold核心内容对照6例通过按业务键/行关联检查。local064追加标记的全年月份和唯一净额差已另核对。
- 本次不访问数据库、不重跑模型，不改官方Gold/评分；只基于此前真实执行记录、不可变发布CSV和原卷宗做合并复核。
- 没有声称Gold源码、原生成环境或所有样本业务定义都已核验。符合多个解释的题，仍然保留未决。
- 以前35题研究不是严格零先验盲实验，且探索预算较大；本合并沿用其证据边界，不据人工重算结果估计接口准确率。

历史材料：[61题审查](fieldtree-wrong118-20261010-analysis.md)、[35题实际重算](fieldtree-unresolved35-recompute.md)。本报告的新增标记不覆盖历史结论，local064增补与local358待确认状态有明确说明。
'''
out=HERE.parent/'fieldtree-gold-markers-and-agent-patterns.md';out.write_text(md,encoding='utf8',newline='\n');print(out)
