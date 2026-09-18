WITH member_first AS (
    SELECT id_bioguide, MIN(term_start) AS first_start
    FROM legislators_terms
    WHERE id_bioguide IS NOT NULL AND id_bioguide <> ''
      AND term_start IS NOT NULL AND term_start <> ''
    GROUP BY id_bioguide
),
cohort AS (
    SELECT id_bioguide, first_start,
           CAST(strftime('%Y', first_start) AS INTEGER) AS start_year
    FROM member_first
    WHERE first_start >= '1917-01-01' AND first_start <= '1999-12-31'
),
periods(period) AS (
    VALUES (1),(2),(3),(4),(5),(6),(7),(8),(9),(10),(11),(12),(13),(14),(15),(16),(17),(18),(19),(20)
),
checks AS (
    SELECT c.id_bioguide, p.period,
           CAST(c.start_year + p.period - 1 AS TEXT) || '-12-31' AS check_date
    FROM cohort c
    CROSS JOIN periods p
),
retained AS (
    SELECT DISTINCT ck.period, ck.id_bioguide
    FROM checks ck
    JOIN legislators_terms t
      ON t.id_bioguide = ck.id_bioguide
     AND t.term_start IS NOT NULL AND t.term_start <> ''
     AND t.term_start <= ck.check_date
     AND (t.term_end IS NULL OR t.term_end = '' OR t.term_end >= ck.check_date)
)
SELECT p.period,
       ROUND(CAST(COALESCE(r.n_retained, 0) AS REAL) / (SELECT COUNT(*) FROM cohort), 6) AS retention_rate
FROM periods p
LEFT JOIN (
    SELECT period, COUNT(*) AS n_retained
    FROM retained
    GROUP BY period
) r ON r.period = p.period
ORDER BY p.period
