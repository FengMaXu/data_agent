# 独立题解
题目：“Among job postings that specifically have the Data Analyst, require a non-null annual average salary, and are remote, what is the overall average salary when considering only the top three most frequently demanded skills for these positions?”
没有业务文档。岗位类别job_title_short精确Data Analyst，remote映射job_work_from_home=1，薪资字段salary_year_avg IS NOT NULL，不加薪资>0或salary_rate筛选。按job_id定义发布实体；技能需求频率以符合资格岗位中每技能不同job_id数量，技能关联先去重复(job_id,skill_id)，验证job_id、skill_id唯一。
选需求频率前三技能，严格3个，平手skill_id排序。最后“overall average salary”解释为要求至少一个前三技能的不同岗位等权平均，岗位有多个前三技能不重复赋权；不是三个技能平均薪资的等权平均，也不是岗位-技能关联行平均。三者皆有合理阅读空间，后两者实验算出并保留假定。若所有前三同时具备，是更窄AND候选，也实测但不默认。验证排名总体是否应包括无薪岗位，默认明确资格作用于全题。
