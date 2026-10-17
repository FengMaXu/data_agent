from parent_ops import *
import sys
id=sys.argv[1]
comp=json.loads((HERE/'cases'/id/'comparison-input.json').read_text(encoding='utf8'))
if id=='local096':
 base="""WITH persons AS MATERIALIZED(SELECT PID,MAX(CASE WHEN Gender='Male' OR Gender='None' THEN 1 ELSE 0 END) known_bad,MAX(CASE WHEN Gender IS NULL THEN 1 ELSE 0 END) unknown,MAX(CASE WHEN Gender='Female' THEN 1 ELSE 0 END) female FROM Person GROUP BY PID),c AS MATERIALIZED(SELECT DISTINCT MID,TRIM(PID) pid FROM M_Cast),flags AS (SELECT c.MID,COUNT(*) n,MAX(COALESCE(p.known_bad,0)) bad,MAX(CASE WHEN p.PID IS NULL OR p.unknown=1 THEN 1 ELSE 0 END) unknown,MAX(COALESCE(p.female,0)) female FROM c LEFT JOIN persons p ON p.PID=c.pid GROUP BY c.MID),mf AS(SELECT m.MID,m.title,CAST(substr(m.year,-4) AS INTEGER) year,f.* FROM Movie m JOIN flags f ON f.MID=m.MID) """
 query(id,'parent-post-unknown-counterexamples',base+"SELECT MID,title,year,n,bad,unknown,female FROM mf WHERE bad=0 ORDER BY year,MID")
 query(id,'parent-post-ignore-null-variant',base+"SELECT year,COUNT(*) total_movies,100.0*SUM(bad=0)/COUNT(*) ignored_null_percentage,100.0*SUM(bad=0 AND unknown=0)/COUNT(*) explicit_female_percentage FROM mf GROUP BY year ORDER BY year",150)
 query(id,'parent-post-unknown-actor-identities',"WITH c AS MATERIALIZED(SELECT DISTINCT MID,TRIM(PID) pid FROM M_Cast) SELECT m.title,m.year,p.PID,p.Name,p.Gender FROM c JOIN Movie m ON m.MID=c.MID LEFT JOIN Person p ON p.PID=c.pid WHERE m.MID IN ('tt1220634','tt2283748')")
elif id=='local098':
 query(id,'parent-post-actor-upper-bound',"SELECT 'cast_raw' kind,COUNT(DISTINCT PID) n FROM M_Cast UNION ALL SELECT 'cast_normalized',COUNT(DISTINCT TRIM(PID)) FROM M_Cast UNION ALL SELECT 'persons',COUNT(DISTINCT PID) FROM Person UNION ALL SELECT 'credit_movie_join',COUNT(DISTINCT TRIM(c.PID)) FROM M_Cast c JOIN Movie m ON c.MID=m.MID")
 query(id,'parent-post-gap-boundary',"WITH years AS (SELECT DISTINCT TRIM(c.PID) pid,CAST(substr(m.year,-4) AS INTEGER) y FROM M_Cast c JOIN Movie m ON c.MID=m.MID),o AS(SELECT pid,y,LAG(y) OVER(PARTITION BY pid ORDER BY y) prev FROM years),g AS(SELECT pid,COALESCE(MAX(y-prev),0) d FROM o GROUP BY pid) SELECT COUNT(*) all_actors,SUM(d<=3) incorrect_three_year_gap,SUM(d<=4) correct_max_three_missing_years,SUM(d=4) distinguishing_actors FROM g")
elif id=='local100':
 own=(HERE/'cases'/id/'parent-independent.sql').read_text(encoding='utf8');base=own[:own.rfind('SELECT COUNT(*) actors_shahrukh_number_2')]
 query(id,'parent-post-gender-projection',base+"SELECT p.Gender,COUNT(DISTINCT h.pid) actors,COUNT(*) person_rows,COUNT(DISTINCT TRIM(p.Name)) names FROM second_hop h JOIN Person p ON p.PID=h.pid GROUP BY p.Gender")
 query(id,'parent-post-canonical-bfs-examples',base+"SELECT h.pid,MIN(TRIM(p.Name)) actor_name FROM second_hop h JOIN Person p ON p.PID=h.pid GROUP BY h.pid ORDER BY h.pid LIMIT 10")
 query(id,'parent-post-old-sql',comp['originalSql'])
 # An independent mathematical crosscheck: count 2-reachable minus 1-reachable, all with source bound.
 query(id,'parent-post-graph-set-invariants',base+"SELECT (SELECT COUNT(*) FROM second_hop) d2,(SELECT COUNT(*) FROM first_hop WHERE pid NOT IN(SELECT PID FROM source)) d1,(SELECT COUNT(DISTINCT c.pid) FROM cast_clean c JOIN next_films f USING(MID)) reachable_within_two,(SELECT COUNT(*) FROM second_hop WHERE pid IN (SELECT pid FROM first_hop)) overlaps")
elif id=='local196':
 own=(HERE/'cases'/id/'parent-independent.sql').read_text(encoding='utf8');base=own[:own.rfind('SELECT rating,AVG(total_spent)')]
 query(id,'parent-post-count-payment-variant',base+",paid_counts AS(SELECT customer_id,COUNT(*) payments FROM payment GROUP BY customer_id) SELECT rating,COUNT(*) customers,AVG(total_spent) avg_spend,AVG(subsequent_rentals*1.0) true_subsequent,AVG(payments-1.0) payments_as_rentals FROM per_customer JOIN paid_counts USING(customer_id) GROUP BY rating ORDER BY rating")
 query(id,'parent-post-duplicate-payment-counterexamples',"SELECT p.customer_id,p.rental_id,COUNT(*) payment_events,GROUP_CONCAT(p.payment_id) payment_ids,GROUP_CONCAT(p.payment_date) dates,SUM(p.amount) amounts FROM payment p GROUP BY p.customer_id,p.rental_id HAVING COUNT(*)>1 ORDER BY p.customer_id,p.rental_id")
 query(id,'parent-post-old-sql',comp['originalSql'])
else:raise SystemExit(id)
