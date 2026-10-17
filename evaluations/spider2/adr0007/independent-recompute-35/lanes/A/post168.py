from work import *
id='local168';c=json.loads((ROOT/'cases'/id/'comparison-input.json').read_text());base=json.loads((ROOT/'cases'/id/'final.json').read_text())['sql'];base=base[:base.rfind('SELECT avg(salary_year_avg)')]
query(id,base+'SELECT f.skill_id,f.demand,s.skills FROM frequencies f LEFT JOIN skills_dim s USING(skill_id) ORDER BY demand DESC,skill_id LIMIT 12','post-all-skill-ids.json')
query(id,"SELECT job_title_short,count(*) n,count(distinct job_id) ids FROM job_postings_fact WHERE job_title='Data Analyst' AND job_work_from_home=1 AND salary_year_avg IS NOT NULL GROUP BY 1",'post-exact-title-cohort.json')
query(id,c['originalSql'],'post-original.json')
for label,title in [('short','job_title_short'),('long','job_title')]:
 b=base.replace('job_title_short',title)
 query(id,b+'SELECT t.*,s.skills FROM top_skills t LEFT JOIN skills_dim s USING(skill_id)','post-'+label+'-top3.json')
 query(id,b+'SELECT count(*) selected_jobs,avg(salary_year_avg) avg_salary FROM selected_jobs','post-'+label+'-union.json')
 query(id,b+'SELECT count(*) link_rows,avg(salary_year_avg) association_avg FROM eligible e JOIN links l USING(job_id) JOIN top_skills t USING(skill_id)','post-'+label+'-association.json')
 b=b.replace('FROM eligible e JOIN links l USING(job_id) GROUP BY l.skill_id','FROM eligible e JOIN links l USING(job_id) JOIN skills_dim s USING(skill_id) GROUP BY l.skill_id')
 query(id,b+'SELECT t.*,s.skills FROM top_skills t LEFT JOIN skills_dim s USING(skill_id)','post-'+label+'-known-top3.json')
 query(id,b+'SELECT count(*) selected_jobs,avg(salary_year_avg) avg_salary FROM selected_jobs','post-'+label+'-known-union.json')
 query(id,b+'SELECT count(*) link_rows,avg(salary_year_avg) association_avg FROM eligible e JOIN links l USING(job_id) JOIN top_skills t USING(skill_id)','post-'+label+'-known-association.json')
 query(id,b+'SELECT l.skill_id,count(*) n,avg(e.salary_year_avg) mean FROM eligible e JOIN links l USING(job_id) JOIN top_skills t USING(skill_id) GROUP BY l.skill_id','post-'+label+'-known-skill-means.json')
query(id,'SELECT job_id,skill_id,count(*) n FROM skills_job_dim GROUP BY 1,2 HAVING count(*)>1 LIMIT 10','post-global-link-duplicates.json')
