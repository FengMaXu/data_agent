"""Parent completion after bounded child runs ended; source run stays read-only."""
import json
from pathlib import Path
HERE=Path(__file__).resolve().parent
META=json.loads((HERE/'artifact-summary.json').read_text(encoding='utf8'))
PACK=Path(META['packet_root'])

def packet(i):return json.loads((PACK/(i+'.json')).read_text(encoding='utf8'))
def dump(v):return json.dumps(v,ensure_ascii=False)
def record(i,title,standard,actual,cause,recommendation,status='unresolved',node=None,layer=None,visibility=None,pattern='insufficient_evidence',secondary=None,limits=None):
    x=packet(i);sets=[c for c in x['calls'] if c['tool']=='set_answer_spec']
    last=sets[-1];fs=last['details'].get('fields',[])
    focus=[f for f in fs if f['path'] in {node,'population.entity','population.eligibility','measure.formula','grouping','selection','output'}]
    desc='最后set返回 index'+str(last['trace_index'])+'：'+'；'.join(f['path']+'='+f['status'] for f in focus)+'。'
    r={'instance_id':i,'attempt_id':x['registry']['attempt_id'],'cause_status':status,'bifurcation_node':node,'error_layer':layer,'visibility':visibility,'title':title,'standard':standard,'actual':actual,
       'observed_difference':'实际CSV '+str(x['predicted_csv']['rows'])+'行，前部值 '+dump(x['predicted_csv']['head'])+'；Gold '+str(x['gold_csv'][0]['rows'])+'行，前部值 '+dump(x['gold_csv'][0]['head'])+'。比较设置 '+dump(x['evaluation_settings'])+'。',
       'spec_handling':desc,'cause':cause,'process_findings':[],'primary_pattern':pattern,'secondary_patterns':secondary or [],'recommendation':recommendation,'limitations':limits or ['Gold SQL未提供；未执行数据库SQL，不从不同数值恢复不可见口径。'],'evidence':[]}
    return r

NEW=[
record('local049','三年最多新独角兽行业的年均公司数','2019–2021按成为独角兽的年份计新公司，选窗口总数最多行业，三年等权均值。','公司日期先MIN(date_joined)，行业关联去重，公司年计COUNT DISTINCT；选三年总数最大行业，SUM/3。','最终date_joined、三年分母和窗口总数排名符合可见定义。57.67与59.67不支持把COUNT DISTINCT、日期去重或行业范围任一项直接判成原因；Gold SQL及实际公司清单不可见。','补Gold公司清单及多日期/多行业政策，再分辨身份或归属规则。',secondary=['source_or_identity','count_or_join']),
record('local050','法国月均预测销售额的中位数','2019/2020法国且promo_total_id=channel_total_id=1；产品月增长预测2021，按币表换USD，先月内平均、后月间中位数。','两年产品月内联、2019非零；2021预测=s20²/s19，2021法国月汇率内联；产品均值再月中位数。','显式公式和聚合顺序被兑现。仅差51.5363美元，不能认定缺基年或缺汇率处理、总体或汇率年度是Gold规则。两年有效投影总体与月份缺失是待核验候选，不是已证错因。','补两年产品月清单、缺率/零基年政策及Gold SQL；保持指定median(avg(projected))层次。',secondary=['population_scope','time_or_missing']),
record('local056','支付金额月变化最高的客户','按客户比较平均月变化，输出全名；题面未唯一限定月内SUM/AVG、绝对/相对变化、缺月政策。','日历严格相邻的客户月SUM(amount)做差，再平均，最大者MICHEAL FORMAN；不补零、跨缺口不计。','已登记三个公式候选并重跑被错误标记的变化率探针，最终只计算日历相邻绝对合计差；其他候选/零填充观测不能由STEPHEN QUALLS恢复Gold公式。语义指引只约束日历检查，不是缺月业务政策。','补Gold公式与缺月处理，反证SUM/AVG、差值/率和相邻期间各候选；不以advisor概率为定义。',secondary=['formula_aggregation','time_or_missing']),
record('local059','各事业部前三硬件产品的整体均值','2021日历年先各事业部选销量前三，再按overall average表述确定最终汇总范围；产品与SKU身份有待定义。','按division+product名称汇总，各division取3，再跨9产品AVG，单行794864.89。','单标量与Gold三事业部行的向量长度失配足以判0；不是列别名问题。overall average与in each division的最终范围存在歧义，不能把Gold分组升格唯一业务定义。名称合并与product_code的未证决定会改变值，但Gold SQL缺失，不能解释三项数值。','先确定overall是跨部还是各部；补产品/SKU定义。若采用分部输出需显式修订grouping与分母，而不是默加GROUP BY贴Gold。',status='confirmed',node='output',pattern='output_values',secondary=['source_or_identity'],limits=['已证仅限评分布局不兼容；总体实体、最终业务范围与Gold数值来源未确定。']),
record('local269','末级包装组合总数量的均值','完整展开嵌套关系，叶项目数量沿路径相乘、组合内求和，再跨final packaging combinations平均；组合身份未专门定义。','把不被任何包装包含的根当组合，跨路径保留重复叶出现；4根叶总量864/720/960/1240，AVG=946。','最终SQL与成功嵌套avg(sum)一致。叶种类、路径发生、根组合是不同可能平均实体；Gold530.67无法裁定“final combination”是否根或根-叶组合，不能反推去重/数量丢失。','补组合实体定义和Gold展开表；对根-叶-路径各粒度逐项复核，别删掉混合包装重复路径迎合值。',secondary=['source_or_identity','formula_aggregation']),
record('local270','根包装中累计数量超过500的项目','根包装不被其它包装包含，同根同项目所有嵌套路径数量累加后>500。','逐层乘qty，同根同叶SUM；Pallet Mix SG的Bottle 500cl两路径600+256=856，纳入4对。','观察完整12条边：534→523→502为20×30=600，534→524→511→502为16×8×2=256。534未被任何边包含，856>500，Gold仅3对且漏掉该对，违背根与累计阈值。不能将额外total_quantity列当失分原因，也不恢复不可见Gold内部去重策略。','复核并修正Gold漏项；保留路径乘数和同根叶总和。API错误另做接口回归，不换成加法零行读法。',status='gold_conflict',node='population.conditions',layer='标准答案有问题',pattern='gold_conflict',secondary=['formula_aggregation','spec_api_friction'],limits=['Gold SQL缺失；这里只证明具体漏项，不推断Gold内部实现。']),
record('local272','订单423仓库1 FIFO精确拣货','每产品累计拣货须等于订单423累计需求，不超库存；购买日、数量排序。','需求SUM到产品，仓库1批次FIFO累积，6520拣14+20+6=40，4280拣36+24=60。','订单原探索index29返回6520需求40且仅1条订单行。Gold该产品14+12=26≠40，违反explicit total picked matches cumulative ordered；本次无同产品多订单行，不能把未逐line分配当实际失分原因。记录picking_line探针用仓库2，也不是合格替代来源。','先修正Gold需求守恒；再给多行、库存不足等最小用例验证分配，不能删14件让SQL贴26。',status='gold_conflict',node='measure.formula',layer='标准答案有问题',pattern='gold_conflict',secondary=['spec_api_friction'],limits=['Gold SQL缺失，26的内部由来未定；多行序列在本订单没有触发。']),
record('local273','FIFO平均拣货比例','按购买日及批次数量FIFO，要求量与库存量区间交集决定拣量，按产品名AVG比例。','需求按订单日期累计，产品总库存压缩后算每订单行min(qty,max(0,total-prev))；以订单行需求作分母，AVG×100。','压缩总库存可保持全部批次被允许的需求总满足量，不应仅凭看不到location就判FIFO必错。比例分母是需求量还是库存量、均值单元是订单还是非零分配区间未获专属定义。两个探针均不等Gold，不能认定选择B就证明错因。','补分配行粒度与比例分母；保留订单-批次交集表，在确定口径后再按产品平均。',secondary=['formula_aggregation','count_or_join','spec_api_friction']),
record('local275','2017每月季调比均高于2的产品','文档ratio=实际销售/CMA；2017每月均>2，不是某月或全年最大值>2。','最终先对月份去重再编号，正确t13..24；两12月窗口CMA，按产品MIN(ratio)>2，输出空。','Gold含Reindeer Fuel等2017有实际零销售月份的产品。qty=0、CMA非负时不能使ratio>2；完整最终月映射探针min ratio分别有0或0.065，不满足every month。已修掉早期SELECT DISTINCT mth,ROW_NUMBER同时用造成的月份复制，不能把早期复制作为最终错因。formula两个候选最终只被记equivalent，并不证明Gold或候选业务正确。','核对Gold是否错误用了ANY/MAX条件。保留EVERY/MIN；为零月份、真连续月与两窗口定义加回归样例。',status='gold_conflict',node='population.conditions',layer='标准答案有问题',pattern='gold_conflict',secondary=['time_or_missing'],limits=['Gold SQL缺失；证实成员不满足forall，不反推它内部一定用MAX。']),
record('local277','两产品2018季调加权回归年销量均值','指定前36个月、季调7..30、weighted regression；需明确回归对象与权重后才能确定具体估值。','CMA与月季节指数后，在7..30对CMA做无显式权重OLS，趋势乘指数；12个月SUM再两产品AVG=460.51。','成功formula文本明确ordinary least-squares，SQL用COUNT/SUM无权重。题面weighted被未证OLS假定替代，是可证方法分叉；月窗口权重不等于回归权重。文档只定义CMA/ratio，未提供回归权重，故不能宣称这一差异独自还原Gold39.39。','补权重、回归目标、年汇总定义；保留指定加权方法，禁止用OLS作为等价默认；逐阶段核对CMA、季调、回归与年层。',status='confirmed',node='measure.formula',layer='口径错',visibility='假定错',pattern='formula_aggregation',limits=['可证没有声明或实现所要求的回归权重；具体权重与Gold39.39来源未知。']),
record('local279','递归补货后离最低库存最近的月份','December2018库存作种子，2019逐月减需求，低于最低库存时补货，逐产品选绝对差最小月份；并列未定。','种子库存SUM；2019需求来自monthly_budget，递归当月扣需后补一次；最小差并列取较早月。','纯离线按原trace库存/预算算术得到6520六月差0、十二月差100；6600三月与八月差10、六月差50。Gold十二月0与六月10不只是同一当前序列的并列裁决。种子来源、需求表、补货作用时点仍缺定义，不能仅把月份ASC改DESC。','补December库存快照和月需求源、补货阶段，再完整对比12期状态；不要将这种差异归为只改tie-break。',secondary=['source_or_identity','time_or_missing','ranking_or_ties']),
record('local283','跨国家联赛每赛季最高积分球队','已审核标准明确最终season粒度、partitionBy season；球队积分胜3平1负0。','先season-country-league-team求和，再在season-country-league内RANK1，共90行。','最早可证最终排名域扩张：grouping成功假定season+country+league，SQL兑现该假定，按联赛分别冠军而非跨全国家联赛每赛季冠军。strict88/include_ties90两候选都在错误域内；并列调整不能得到8季答案。Gold还要求未题面要求的season_rank，需另审评分列约定。','最终RANK仅partition season，明确全局每季选取；验证Gold额外rank列的结构性约定，不能混作积分业务要求。',status='confirmed',node='grouping',layer='口径错',visibility='假定错',pattern='ranking_or_ties',secondary=['output_values'],limits=['题面自然语言有“联赛冠军”背景读法；这里按已审核season标准判定。Gold额外rank列需独立规范。']),
record('local285','蔬菜分类年度财务指标','2020–2023分类×年，多项价格/收入/损耗/利润两位小数；损耗与利润专属公式未给出。','价统计按批发日行；收入与成本按匹配交易量；损耗逐item-day×rate，利润明确不减损耗；平均loss在全类别商品级计算不随年变。','Gold Capsicum2020利润等于125582.87−82190.88−6567.05，采用扣损耗形态，当前formula主动排除该候选；但题面未定义gross/net，不能仅凭Gold裁定业务。多项均值权重/归属与联结也不同：只扣损耗探针仍未复原Gold，原因组合未唯一定位。','先明确价/率均值的观测单元、净利润是否扣损耗、日期匹配及退货规则，再逐项修订；别将全部差异归为单次连接放大。',secondary=['formula_aggregation','population_scope']),
record('local286','超过100件卖家的销量评价打包报表','卖家销售数量>100；各指标业务权重和packing起止、英文最高销量类别并列规则未完整定义。','订单商品行COUNT>100，得到236卖家；价格商品加权，评价和packing订单去重；packing从approved到carrier。','Gold237卖家多一个ID 2a7dc43cecabf23403078e2188437d1d。评分还检查Gold的product_cnt，但当前输出缺数量列；评价与packing亦不同。Gold108可能来自不同权重/总体，不能断言必有review放大；无此卖家的实际源数量无法裁定其资格。','补该卖家源数量、评价分母、packing事件定义；对输出评分约定独立审计，再做数量阈值/订单权重回归。',secondary=['count_or_join','time_or_missing','output_values'])
]

def add_baseline_citations(r):
    x=packet(r['instance_id']);refs=x['source_refs'];tr=json.loads(Path(refs['trace']).read_text(encoding='utf8'))
    r['evidence'] += [{'role':'request','source_file':refs['dataset'],'record_id':r['instance_id'],'json_pointer':'/question','quote':x['question'],'supports':'本题原始题面，区分显式要求与未定义细则。'},
        {'role':'sql','source_file':x['registry']['sql_file'],'json_pointer':None,'quote':x['submitted_sql'].strip(),'supports':'本attempt实际提交SQL；与result.finalSql及官方评分SQL缓存核对一致。'}]
    for role,file in [('result',x['predicted_csv']['file']),('result',x['gold_csv'][0]['file'])]:
        text=Path(file).read_text(encoding='utf-8-sig');r['evidence'].append({'role':role,'source_file':file,'json_pointer':None,'quote':'\n'.join(text.splitlines()[:7]),'supports':'实际预测/Gold CSV值；全文用于行数、成员和评测列的离线核对，展示前六行。'})
    sets=[(i,c) for i,c in enumerate(tr['toolCalls']) if c['toolName']=='set_answer_spec' and isinstance(c.get('result',{}).get('details',{}),dict) and c.get('result',{}).get('details',{}).get('fields')]
    i,c=sets[-1];fs=c['result']['details']['fields'];wanted={r.get('bifurcation_node'),'measure.formula','population.eligibility','selection','output'}
    for j,f in enumerate(fs):
        if f['path'] in wanted:
            r['evidence'].append({'role':'spec','source_file':refs['trace'],'json_pointer':f'/toolCalls/{i}/result/details/fields/{j}','quote':dump(f),'supports':'工具实际返回的最终字段状态与值（不是被拒参数）。'})
    return r

def extra(r,index,pointer,supports):
    from review_helpers import resolve
    x=packet(r['instance_id']);trace=json.loads(Path(x['source_refs']['trace']).read_text(encoding='utf8'));ptr=f'/toolCalls/{index}/result'+pointer;v=resolve(trace,ptr)
    r['evidence'].append({'role':'process','source_file':x['source_refs']['trace'],'json_pointer':ptr,'quote':v if isinstance(v,str) else dump(v),'supports':supports})


def main():
    lanes=json.loads((HERE/'lanes.json').read_text(encoding='utf8'));by_id={}
    for lane in lanes:
        f=Path(lane['output'])
        if f.exists():by_id.update({r['instance_id']:r for r in map(json.loads,f.read_text(encoding='utf8').splitlines())})
    for r in NEW:by_id[r['instance_id']]=r
    for r in by_id.values():
        if not r['evidence']:add_baseline_citations(r)
    additions={
      'local269':[(9,'/details/artifact/preview','展开的7个叶发生，支持4个根各自合计；不代表业务定义。')],
      'local270':[(8,'/details/artifact/preview','完整包装边及数量：两条534→502路径累计856，534无上级。')],
      'local272':[(29,'/details/artifact/preview','订单423实际每产品需求与行数，6520明确40。')],
      'local275':[(4,'/details/content','任务业务文档逐字ratio/CMA定义。'),(14,'/details/artifact/preview','Reindeer Fuel2017实际零月份；Gold仍把它列入every-month>2。'),(28,'/details/artifact/preview','最终月编号修复后的十二个月ratio范围。')],
      'local277':[(4,'/details/content','业务文档没有权重回归公式；定义的权重窗口属于CMA。')],
      'local279':[(6,'/details/artifact/preview','最低库存和单次补货量。'),(14,'/details/artifact/preview','全24个月预算。'),(16,'/details/artifact/preview','产品库存种子400/100。')],
      'local286':[(6,'/details/artifact/preview','按当前商品行阈值有236卖家；不证明Gold多出卖家的真实数量。')]
    }
    for id,es in additions.items():
        for index,ptr,why in es:extra(by_id[id],index,ptr,why)
    x=packet('local283');by_id['local283']['evidence'].append({'role':'standard','source_file':x['source_refs']['standard'],'record_id':'local283','json_pointer':'/facets/ranking/alternatives/0','quote':dump(x['standard_semantics']['facets']['ranking']['alternatives'][0]),'supports':'已审核标准的最终排名域为season。'})
    for lane in lanes:
        Path(lane['output']).write_text(''.join(dump(by_id[id])+'\n' for id in lane['ids']),encoding='utf8')
    print('Completed',len(by_id),'records; parent added 14 analyses and cited 31 interrupted drafts.')

if __name__=='__main__':main()
