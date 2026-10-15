# local168：已精确重建Gold，但多层业务解释仍不唯一

原题逐字：“job postings that specifically have the Data Analyst”；“non-null annual average salary, and are remote”；“overall average salary when considering only the top three most frequently demanded skills”。无业务文档。

## 独立算法与冻结答案
按job_title_short='Data Analyst'、remote=1、年薪非NULL，按不同job_id计需求，前三skill_id需求降序/ID升序，最后至少要求一个选中技能的独立岗位等权平均。46个合格岗位/46唯一ID；选skill IDs0、1、5（各需求3），9个岗位，总薪资834203，均值 **92689.22222222222**。冻结后才揭Gold **101300**，原 **104040.60**，官方评分0。前述题面可读为岗位平均，也可读为技能均薪再平均；选择前者是假定，不是业务事实。

## 实验矩阵与精确反例
skills_dim只有26行/26唯一ID；合格技能关联22行/22唯一(job,skill)，但有大量skill_id没有维度名字，频率最高IDs0、1、5、181、182均3，只有1在维度（python）；还有187=qlik需求1。不能说维度缺失就不是技能，也不能称成功凑足三种具名技能。

| 标题总体 | 技能身份 | 岗位OR等权 | 岗位-技能行等权 | 技能均薪等权 |
|---|---|---:|---:|---:|
| 短标题类别46岗位 | 原关联ID前三0/1/5 | 92689.222222 | 92689.222222 | 未用于Gold重建 |
| 完整标题精确17岗位 | 原关联ID前三182/0/1 | 104040.6 | 104080.571429 | 未用于Gold重建 |
| 短标题类别 | 仅skills_dim可识别的1/187（只有2种） | 106900 | 104100 | **101300** |
| 完整标题精确 | 仅skills_dim可识别的1/187（只有2种） | 92850 | 93800 | 94275 |

Gold精确数值重建：python3岗位均薪106900，qlik1岗位均薪95700，再(106900+95700)/2=**101300**。反例岗位1791218薪资95700同时要求python与qlik；其余python岗位419649薪90000、777802薪135000。去重岗位平均=(90000+135000+95700)/3=106900；关联行平均另多计95700得到104100；技能等权平均101300。三个公式不同，Gold不是简单关联行多权，而是两层技能等权。这足以构造全部标量失分，不证明Gold内部唯一算法。

## 最后看的原Spec/SQL
成功原Spec选择job_title='Data Analyst'，曾探索短标题但之后改变选择；这是population.conditions最早与独立解及Gold等值变体分叉。selection最终明确“技能身份=skills_job_dim.skill_id（不要求该skill_id在skills_dim中有名称行）”，joinMultiplicity明确去重job_id后平均、formula/countGrain/denominator均为岗位等权。旧SQL准确实现其选择，没有证据说SQL无意遗漏一个已声明的JOIN或AVG层。原Spec误称“skills_job_dim 与 skills_dim 均为 job_id×skill_id 粒度”，skills_dim实际无job_id；属局部物理粒度描述错误，但不能解释全部失分。

## 归因与限制
**ambiguous_after_recompute**。已定位可重复的数值差异：标题总体、技能维度资格、最终平均权重三项共同改变可精确获得Gold。最早分叉conditions，随后selection和formula/denominator；都在原Spec可见，非字段遗漏。题面没有明确完整/短标题、未知技能有效性及技能等权分母，不能仅凭数值贴标准标签或认定原解释必错。Gold等值算法实为2技能，不满足字面“三种”完整性；数据限制确证，Gold是否在完整数据上另有含义未证。独立结果含无维度名称ID且有5种频率并列、严格取3任意ID，发布时已记录假定，但需要对业务用户披露选择敏感性。揭示后全部结果为探索，不改冻结交付。
