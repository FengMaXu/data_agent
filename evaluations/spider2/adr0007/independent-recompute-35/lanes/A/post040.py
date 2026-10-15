from work import *
id='local040';c=json.loads((ROOT/'cases'/id/'comparison-input.json').read_text())
query(id,'SELECT * FROM income_trees WHERE zipcode IN (SELECT zipcode FROM income_trees GROUP BY zipcode HAVING count(*)>1) ORDER BY zipcode','post-income-duplicates.json')
query(id,'SELECT tree_id,count(*) n,count(distinct zipcode) zips,count(distinct boroname) boroughs FROM trees GROUP BY tree_id HAVING count(*)>1 ORDER BY n DESC LIMIT 10','post-tree-duplicates.json')
query(id,'SELECT count(*) rows FROM (SELECT DISTINCT * FROM trees)','post-distinct-tree-rows.json')
old=c['originalSql'];query(id,old,'post-original.json')
query(id,old.replace('FROM trees t','FROM (SELECT DISTINCT * FROM trees) t'),'post-distinct-tree-original.json')
query(id,old.replace('FROM trees t','FROM (SELECT * FROM trees GROUP BY tree_id) t'),'post-unique-tree-original.json')
base=json.loads((ROOT/'cases'/id/'final.json').read_text())['sql']
query(id,base.replace('FROM trees t','FROM (SELECT DISTINCT * FROM trees) t').replace('JOIN income_trees i','JOIN (SELECT DISTINCT * FROM income_trees) i'),'post-dedup-both-rows.json')
query(id,base.replace('FROM trees t','FROM (SELECT * FROM trees GROUP BY tree_id) t').replace('JOIN income_trees i','JOIN (SELECT * FROM income_trees GROUP BY zipcode) i'),'post-first-both-keys.json')
