WITH monthly AS (
  SELECT p.customer_id AS customer_id,
         strftime('%Y-%m', p.payment_date) AS ym,
         SUM(p.amount) AS val
  FROM payment p
  GROUP BY p.customer_id, strftime('%Y-%m', p.payment_date)
), pairs AS (
  SELECT m1.customer_id AS customer_id,
         m1.val - m2.val AS chg
  FROM monthly m1
  JOIN monthly m2
    ON m2.customer_id = m1.customer_id
   AND m2.ym = strftime('%Y-%m', date(m1.ym || '-01', '-1 month'))
), avg_chg AS (
  SELECT customer_id, AVG(chg) AS avg_monthly_change
  FROM pairs GROUP BY customer_id
)
SELECT c.first_name || ' ' || c.last_name AS full_name
FROM avg_chg a
JOIN customer c ON c.customer_id = a.customer_id
ORDER BY a.avg_monthly_change DESC
LIMIT 1;

