"""Only invoked by the Answering executor after task-bound authorization. Never use directly."""
import sys,json,sqlite3,time,math
from pathlib import Path
payload=json.load(sys.stdin)
start=time.monotonic()
con=sqlite3.connect(Path(payload['database']).resolve().as_uri()+'?mode=ro',uri=True)
con.execute('PRAGMA query_only=ON')
con.set_progress_handler(lambda: 1 if time.monotonic()-start>120 else 0,10000)
con.create_function('sqrt',1,lambda v:None if v is None else math.sqrt(v))
con.create_function('power',2,lambda a,b:None if a is None or b is None else a**b)
con.create_function('pow',2,lambda a,b:None if a is None or b is None else a**b)
for name in ['sin','cos','tan','asin','acos','atan','radians','degrees','exp','ln','log']:
    f=math.log if name in ['ln','log'] else getattr(math,name)
    con.create_function(name,1,lambda v,f=f:None if v is None else f(v))
try:
    cur=con.execute(payload['sql'])
    limit=int(payload['limit'])
    rows=cur.fetchmany(limit+1)
    print(json.dumps({'columns':[x[0] for x in cur.description],'rows':rows[:limit],'truncated':len(rows)>limit},ensure_ascii=False,allow_nan=False))
finally:
    con.close()
