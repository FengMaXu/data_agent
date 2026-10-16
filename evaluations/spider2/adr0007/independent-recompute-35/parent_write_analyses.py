from parent_ops import *
from datetime import datetime,timezone
DATA={
'local096':{
'status':'gold_conflict','summary':'按题面排除未知性别实算仅4部全女影片；Gold额外计入2009/2012无可识别演员、2018演员性别NULL的3部影片。忽略NULL反事实逐年精确重现Gold，原SQL处理NULL正确。','body':'''## 独立解题与实算
原题明确“no actors with unknown/unspecified gender”，故每电影至少有已识别出演者，且所有演员明确Female；以全部Movie作年分母。先独立检查物理键，M_Cast.PID带外围空白，Person存在同PID重复但性别无冲突；按PID预聚合性别、TRIM身份连接，再按电影聚合，避免演员连接放大电影总数。3475电影全部有cast记录，不存在空cast选择在本数据影响结果。
真实符合者仅4部：1939 Kala Jigar，1999 Bindhaast，2000 Snegithiye，2018 Pihu。其年百分比分别50、1.5151515、1.5625、0.96153846，其余年为0。最终78行已发布并冻结，官方分0，不能因此抹掉题面要求。
## Gold差异与反证
Gold在2009计1/110、2012计1/111，2018计2/104。实查其额外候选：tt1587388和tt2355921的唯一cast PID为NULL，无法连接演员；tt8338754的演员Vaibhav Sethia的Gender为SQL NULL。它们都不能满足题面“no actors with unknown/unspecified gender”。
只将资格改为“没有已知Male/字符串None”，忽略SQL NULL与孤立身份，即得到7部资格影片，逐年全部Gold比例精确重现。此反事实充分解释当前数值，但没有Gold SQL，不能声称已经查到Gold原始代码；也不能排除标准生成数据库版本不同。
## 最后审查原字段
原measure.denominator明确“性别为 Male 或 NULL（未知/未指定）的演员视为非女性”；最终SQL CASE WHEN Gender='Female' THEN1 ELSE0 END把NULL正确判为非女。原公式另决定“无演员记录的电影算作满足”，从措辞看存在资格风险，但实际空cast为0，不能拿它解释本次失分。原按年保留全部电影和解析末4位也与独立实算一致。
本题最早可证差异在Gold的population.eligibility/conditions，而不是原Spec隐藏节点。错误层为本次输入下标准答案局部冲突；原语义错误可见性不适用。
''',
'proofs':[('parent-cast-integrity-response.json','/details/preview/rows','3475'),('parent-post-null-only-film-cast-response.json','/details/preview/rows','Vaibhav Sethia'),('parent-post-ignore-null-variant-response.json','/details/preview/rows','0.9615384615384616')],
'spec_path':'measure.denominator','spec_quote':'性别为 Male 或 NULL（未知/未指定）的演员视为非女性','limitations':['Gold SQL缺失；重建NULL机制不是原标准SQL源码证据。','空cast规则原Spec有争议，但在当前数据空cast为0，不构成本题实际失分根因。']},
'local098':{
'status':'gold_conflict','summary':'相邻出演年差≤4确实等价最多3缺年；原28698正确实现。当前全库只有32127可识别出演者，Gold32585超过全集上界。独立初稿误计1个NULL身份，冻结保留并另发布修正28698。','body':'''## 独立算法和一个自查修正
相邻出演年份差d，夹在两次出演之间的空年为d−1；题目禁止连续4年无片，因此d≤4，而非d≤3。每演员出演年DISTINCT后LAG，再取最大差；单年出演者无内部空窗，纳入。演员用PID，非演员姓名合并。
独立初稿得到28699并冻结；揭示后实际检查发现M_Cast有两条NULL PID记录，被GROUP BY合并成1个未知身份并误计为演员。**这是独立题解自己的实现错误，不能隐去。** 保留第一次freeze，追加非NULL/非空身份条件，重新执行最终查询并发布修正Candidate，正确结果28698，与原SQL一致。初次官方分0不变，修正也没有贴合Gold。
## Gold核对和全集上界
当前M_Cast COUNT DISTINCT PID及TRIM PID均32127；连接Movie后可识别PID全集仍32127。Gold32585比出演者全集多458，已超出任何“从首片到末片”活动职业子集的可能上界。Person有37565身份，但其中没有出演记录的人不能自行得到首/末出演年；若标准将其纳入，则需要题面没有的资格规则。
实际相邻年差=4的演员有798名；误用≤3得到27901（包含初稿NULL组），正确≤4为28699，再排除NULL为28698。这证明旧卷宗的“缺口off-by-one”不能成立。不是只因没有Gold SQL就结束，而是用全集约束实际反证。
## 最后审查原Spec/SQL
原population.conditions显式写“相邻出现年份之差不超过4”，原eligibility限至少一条出演记录，SQL还排除mc.PID IS NULL；DISTINCT PID/year及LAG实现正确。原未定位题现可判为当前输入下Gold资格/数据兼容冲突，不能归为原measure.window错。具体标准究竟加入无cast人物、使用另一数据库还是有其他计数缺陷，仍未恢复。
''',
'proofs':[('parent-post-actor-upper-bound-response.json','/details/preview/rows','32127'),('parent-post-gap-boundary-response.json','/details/preview/rows','798'),('parent-post-null-cast-identity-response.json','/details/preview/rows','tt2355921'),('parent-post-correction-note.json','/corrected_count','28698')],
'spec_path':'population.conditions','spec_quote':'相邻出现年份之差不超过 4','limitations':['Gold生成机制/数据库版本未知，只确定当前出演者全集无法支持32585。','独立首稿多计NULL1人；初次冻结不可覆盖，修正SQL和新Receipt另行保留。']},
'local100':{
'status':'gold_conflict','summary':'独立合作图集合计算25698，与原SQL实跑一致；源身份1、直接合作者2382、两步内28081，排除source/一跳得到25698。Gold15911与当前完整图不兼容，隐藏子集或历史数据原因未知。','body':'''## 独立解题
不构造全体演员两两平方图：查到唯一源PID nm0451321（姓名带前导空格的Shah Rukh Khan），取其90部电影的出演PID集合，得到含源本人2383个一跳可达身份；再取这些演员的3206部电影的全部出演者，集合减去一跳及源，得到25698个最短合作距离恰好2的演员。
所有M_Cast电影MID均有Movie记录；全部二跳PID均可连接Person，二跳集合与一跳交集为0。独立最终25698已发布冻结。
## 三方核对与实际交叉检查
原SQLltrim(PID)逐层DISTINCT、排除直接合作者与源，实际复跑同为25698。集合恒等式：两步以内可达28081 −直接2382 −源1 =25698。不是不同join SQL碰巧同数，而是逐层可达集合与互斥关系均检查。
Gold15911小于当前完整二跳集合。即使尝试按性别/姓名投影，Male身份15833、Female7519、未知2346；按Male Person行得到15909也不等15911，更不能因为接近就为题面添加男性过滤。题面没有性别、年代、已知演员等筛选。
所以现可判为本题明确完整图要求与当前Gold不兼容；不声称已查明Gold具体遗漏哪些身份，因为Gold只给总数、没有人物清单/SQL。可能是历史数据库版本或隐藏资格，不把它写成已证实原因。
## 原字段事后审查
原population.conditions明确“存在...中间演员...同时该演员不曾...直接出演”；entity/countGrain为PID，joinMultiplicity强调逐层DISTINCT；最终SQL实现这些要求。没有找到原字段声明或SQL最短距离实现错误；不是字段树阻止不了错误，而是当前标尺不能支持这个完整图答案。
''',
'proofs':[('parent-hop-counts-response.json','/details/preview/rows','25698'),('parent-post-graph-set-invariants-response.json','/details/preview/rows','28081'),('parent-post-cast-film-integrity-response.json','/details/preview/rows','3475'),('parent-post-gender-projection-response.json','/details/preview/rows','15833')],
'spec_path':'population.conditions','spec_quote':'同时该演员不曾在任何影片中与 Shah Rukh Khan 同片出演','limitations':['Gold只给总数，无法给出其具体遗漏人物；机制/数据版本未唯一定位。','最短图算法按当前完整cast数据验证，不利用接近Gold的性别过滤来改口径。']},
'local196':{
'status':'gold_conflict','summary':'独立与原均按真实rental数减1；Gold五组后续租赁均值精确等于payment记录数减1，其中5条payment.rental_id为NULL。Gold把无租赁关联付款当租赁，局部计数冲突已实证。','body':'''## 独立题解及结果
先按客户独立SUM付款总额，再COUNT DISTINCT rental_id−1，首片取最早payment_date对应影片rating，最后每客户等权平均。真实599客户的首付款全部无并列，故payment_id次序不影响答案。payment16049记录，rental16044事件，有5个客户payment数比租赁数多1；付款所覆盖的非空rental身份与真实rental数一致。
独立5组均值与原SQL重算相同，仅原SQL最后舍入。真实后续租赁均值G25.2980769231、NC-17 25.3589743590、PG26.2641509434、PG-13 26.3809523810、R25.48，花费均值也全部一致。
## Gold失分的实际机制
Gold的后续次数为G25.32、NC-17 25.37、PG26.27、PG-13 26.38、R25.49。只把真实rental数改成payment行数，再减1，就分别得到25.3173076923、25.3675213675、26.2735849057、26.3809523810、25.488，舍入后五组全部精确重现Gold。
实查多出的不是同一租赁多付款，而是payment_id424/7011/10840/14675/15458的rental_id为NULL，客户16/259/401/546/577。它们是付款事件，不是题面“total number of rentals”。支付总额仍应包括它们，不应为了租赁数去删消费总额。当前Gold局部混淆事件实体；未知它原始SQL是否真的COUNT(payment)，重建只是充分的数值机制。
## 最后审查原Spec
原custom公式明确Metric2是“total number of rentals ... −1”，countGrain为客户等权；原SQLCOUNT(*) FROM rental，实际rental_id唯一16044，所以实现正确。原joinMultiplicity甚至记录5条payment NULL rental_id，证明差异信息当时可见；但没有因此误把它们当租赁。本题不存在原字段未声明的错误；Gold计数单位与题面冲突。
''',
'proofs':[('parent-sakila-keys-response.json','/details/preview/rows','16049'),('parent-post-count-payment-variant-response.json','/details/preview/rows','25.317307692307693'),('parent-post-nonrental-payments-response.json','/details/preview/rows','424')],
'spec_path':'measure.formula','spec_quote':'total number of rentals of c - 1','limitations':['Gold SQL缺失；只确认本次结果等价于错误付款事件计数，不断言其隐藏代码。','此类付款存在不一定是数据缺陷，可是真实无关联收费；不能擅自删除总花费。']},
'local286':{
'status':'gold_conflict','summary':'独立与原资格均236卖家；Gold237中额外卖家实际仅54商品、4795.91销售额，却标108件和9591.82，严格>100资格冲突。其余评分/包装时间定义差异已计算但不能唯一裁决。','body':'''## 独立算法与冻结答案
主事实order_items，商品键(order_id,order_item_id)112650条全唯一；每卖家实际售出件数COUNT明细，严格>100得到236卖家。商品销售额与均价单独聚合，不被评论连接复制。评分从distinct seller/order对应评论记录平均；packing采用审批到交承运商的有效非负天数，按订单等权；各卖家最高销量类别按件数，不按收入，英文翻译缺失保留原类别。
这些评分权重、packing起点/负值处理、订单状态都在看Gold前写为假定。冻结236行报告已发布，官方分0。技术适配器起初误拒带limit的final及SQL字面量分号；父只删除非法final参数，并用CHAR(59)保留同一分号分隔值，没有修改独立算法。
## 可确证的Gold资格冲突
Gold237行唯一额外卖家2a7dc43cecabf23403078e2188437d1d，标product_cnt108、total_sales9591.82、avg_price88.813148...。实际查order_items仅54件、SUM(price)4795.91、AVG(price)88.813148...；连order_reviews仍54行，不是本次评论扇出造成倍数。
Gold的108=2×54、9591.82=2×4795.91不能自行证明其隐藏SQL怎样复制，但这个卖家实际54件明确不满足题面“sold a quantity of more than 100 products”。所有其他实体/评论/翻译连接不能授权凭空变出额外54售出件。当前Gold资格与数据局部冲突已经足够，不再停在“237vs236原因未知”。
## 其他差异不能强判
Gold的packing头部可由purchase到carrier均值重现，而独立和原用approved到carrier，题面只说packing times，起点未规定；review均值还受一订单多review与商品权重影响。真实检验了547多review订单、负packing1398 seller-order事件，以及销量/销售额最高类别分叉，仍没有任务业务文档裁决唯一权重和时间区间。这些不全归为Gold错或原SQL错。
原输出6列缺Gold product_cnt第7列是比较合同另一项失败，但用户未明确要求展示该计数，不能只据Gold要求硬判业务信息遗漏。
## 最后审查原字段
原eligibility和conditions均写订单商品行数量>100，SQL按真实商品聚合且严格>100，实现与独立236一致。joinMultiplicity显式规避评论复制商品数量，不存在“为了通过执行静默换计数实体”。公式明确packing approved起点、订单评分均值、类别销量，都是声明了的解释而非遗漏；原timeField的purchase文本与公式还应独立一致性审查，但不足以解释资格冲突。标准资格问题的visibility不适用。
''',
'proofs':[('probe-keys.response.json','/details/preview/rows','112650'),('parent-report-count-response.json','/details/preview/rows','236'),('parent-post-gold-extra-seller-response.json','/details/preview/rows','4795.91'),('parent-post-gold-head-reconstruction-response.json','/details/preview/rows','4.134065715052809')],
'spec_path':'population.eligibility','spec_quote':'订单商品行数）超过 100 件','limitations':['54→108仅重现倍率，未确认Gold内部复制步骤或历史数据库版本。','评分权重、packing起点/负值政策仍未由业务证据唯一裁决。','Gold要求额外数量输出列与用户展示要求不完全相同，独立分0不证明算法全错。']}
}

def ptr(obj,p):
 for k in p.lstrip('/').split('/') if p else []:obj=obj[int(k)] if isinstance(obj,list) else obj[k]
 return obj
for id,info in DATA.items():
 d=HERE/'cases'/id;b=json.loads((d/'blind.json').read_text(encoding='utf8'));c=json.loads((d/'comparison-input.json').read_text(encoding='utf8'));score=json.loads((d/'csv-comparison.json').read_text(encoding='utf8'));fr=json.loads((d/'independent-freeze.json').read_text(encoding='utf8'))
 evidence=[{'source':'blind.json','pointer':'/question','quote':b['question']}]
 for source,p,quote in info['proofs']:
  target=ptr(json.loads((d/source).read_text(encoding='utf8')),p);text=target if isinstance(target,str) else json.dumps(target,ensure_ascii=False)
  assert quote in text,(id,source,quote)
  evidence.append({'source':source,'pointer':p,'quote':quote})
 gold=c['goldCsv'][0]['content']
 if id=='local096': gold=''.join(gold.splitlines(keepends=True)[:7])
 if id=='local286': gold=next(line for line in gold.splitlines(keepends=True) if '2a7dc43cecabf23403078e2188437d1d' in line)
 evidence.append({'source':'comparison-input.json','pointer':'/goldCsv/0/content','quote':gold})
 old=json.loads((d/'parent-original-spec.json').read_text(encoding='utf8'));idx=old['trace_index'];fi=next(i for i,f in enumerate(old['details']['fields']) if f['path']==info['spec_path']);target=old['details']['fields'][fi]['value'];text=target if isinstance(target,str) else json.dumps(target,ensure_ascii=False);assert info['spec_quote'] in text
 evidence.append({'source':old['source'],'pointer':f'/toolCalls/{idx}/result/details/fields/{fi}/value','quote':info['spec_quote']})
 a={'instance_id':id,'status':info['status'],'summary':info['summary'],'fork_node':None,'error_layer':'标准答案与本次题面/输入局部冲突','visibility':None,'independent_score':score['independent_official_score'],'evidence':evidence,'limitations':info['limitations'],'parent_completed':True,'completed_at':datetime.now(timezone.utc).isoformat()}
 save(id,'analysis.json',a)
 md=f'# {id}：独立重算与事后字段审查\n\n**结论：{info["summary"]}**\n\n### 原题（逐字）\n\n> {b["question"]}\n\n'+info['body']+'\n## 可复核原始依据\n\n'
 for e in evidence:
  md+=f'- `{e["source"]}`'+(f'，JSON pointer `{e["pointer"]}`' if 'pointer' in e else '')+'：\n\n'
  q=e['quote'].replace('\r\n','\n');fence='`'*max(3,max((len(z) for z in __import__('re').findall(r'`+',q)),default=0)+1)
  md+=f'{fence}text\n{q}\n{fence}\n\n'
 md+='## 独立最终产物与限制\n\n'
 md+=f'- 初次独立SQL/CSV/Receipt：`cases/{id}/publications/{fr["publication"]["receiptId"]}/`。\n- 初次冻结：`cases/{id}/independent-freeze.json`。官方独立分：{score["independent_official_score"]}。\n'
 if id=='local098':md+='- 已披露独立初稿多计NULL1人的更正：`parent-post-correction-note.json`及其新发布Receipt；不覆盖初次冻结。\n'
 md+='\n'+'\n'.join('- '+x for x in info['limitations'])+'\n'
 save(id,'analysis.md',md)
 print('wrote',id)
