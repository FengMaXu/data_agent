from work import *
id='local002'
base=json.loads((ROOT/'cases'/id/'final.json').read_text())['sql'];base=base[:base.rfind('SELECT sum(ma)')]
query(id,base.replace('coalesce(units,0) y','coalesce(revenue,0) y')+'SELECT a,b,(SELECT sum(ma) FROM smooth) answer FROM model','post-revenue-calendar.json')
query(id,base.replace('coalesce(units,0) y','coalesce(revenue,0) y').replace('FROM calendar c LEFT JOIN daily USING(d)','FROM calendar c JOIN daily USING(d)')+'SELECT n,a,b,(SELECT sum(ma) FROM smooth) answer FROM stats CROSS JOIN model','post-revenue-sparse.json')
query(id,base.replace("julianday(c.d)-julianday('2017-01-01') x","CAST(strftime('%j',c.d) AS REAL) x").replace('coalesce(units,0) y','coalesce(revenue,0) y')+'SELECT n,a,b,(SELECT sum(ma) FROM smooth) elapsed_prediction,sum(a+b*(CAST(strftime(\'%j\',d) AS REAL))) doy_prediction FROM stats CROSS JOIN model CROSS JOIN forecast WHERE d BETWEEN \'2018-12-05\' AND \'2018-12-08\'','post-doy.json')
query(id,base.replace('coalesce(units,0) y','coalesce(revenue,0) y').replace("julianday(c.d)-julianday('2017-01-01') x","row_number() OVER(ORDER BY c.d)-1.0 x").replace('FROM calendar c LEFT JOIN daily USING(d)','FROM calendar c JOIN daily USING(d)')+'SELECT n,a,b,(SELECT sum(ma) FROM smooth) answer FROM stats CROSS JOIN model','post-ordinal.json')
query(id,base+'SELECT n,sy,1.0*(n*sxy-sx*sy)/(n*sxx-sx*sx) precise_b,(sy-1.0*(n*sxy-sx*sy)/(n*sxx-sx*sx)*sx)/n precise_a FROM stats','post-integer-arithmetic.json')
c=json.loads((ROOT/'cases'/id/'comparison-input.json').read_text());t=json.loads(pathlib.Path(c['registry']['trace_file']).read_text(encoding='utf8'));put(id,'original-trace-review.json',t)
