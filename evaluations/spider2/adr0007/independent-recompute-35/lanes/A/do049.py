from work import *
id='local049'
init(id,'新增独角兽公司 company_id','new unicorn companies', '''# 独立题解
题目：“Can you help me calculate the average number of new unicorn companies per year in the top industry from 2019 to 2021?”
无业务文档。new unicorn解释为公司进入独角兽名单的date_joined年份，而非year_founded；数据表名称与字段仅支持物理映射，非业务定义。top industry解释为2019..2021三年新增公司累计最多的同一个行业，不每年换行业，不以估值排名。按公司ID计独立实体，关联行业与date；重复维度行先去重，检查是否有多行业/多日期冲突。
三完整年份2019、2020、2021均参与平均（零年仍除3）。取总数最多行业，平手按行业名称确定单个。输出该行业和total/3的新增公司年均数；观察另测创立年份与年度top变体。
''')
query(id,'SELECT * FROM companies_dates LIMIT 5','date-sample.json')
query(id,'SELECT count(*) rows,count(distinct company_id) companies,count(distinct company_id||date_joined) id_dates FROM companies_dates','date-keys.json')
query(id,'SELECT count(*) rows,count(distinct company_id) companies,count(distinct company_id||industry) id_industries FROM companies_industries','industry-keys.json')
