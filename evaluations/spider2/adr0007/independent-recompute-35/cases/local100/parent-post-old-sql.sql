WITH l1 AS (
  SELECT DISTINCT ltrim(c.PID) AS pid
  FROM M_Cast c
  WHERE c.MID IN (SELECT MID FROM M_Cast WHERE ltrim(PID)='nm0451321')
    AND ltrim(c.PID) <> 'nm0451321'
),
l1_movies AS (
  SELECT DISTINCT c.MID
  FROM M_Cast c JOIN l1 ON ltrim(c.PID)=l1.pid
),
l2 AS (
  SELECT DISTINCT ltrim(c2.PID) AS pid
  FROM M_Cast c2 JOIN l1_movies m ON c2.MID=m.MID
)
SELECT COUNT(*) AS shahrukh_number_2_actor_count
FROM l2
WHERE pid NOT IN (SELECT pid FROM l1)
  AND pid <> 'nm0451321'

