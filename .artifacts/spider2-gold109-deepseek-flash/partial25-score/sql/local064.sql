WITH cm AS (
  SELECT customer_id,
         strftime('%Y-%m', txn_date) AS ym,
         SUM(CASE WHEN txn_type = 'deposit' THEN txn_amount ELSE 0 END)
       - SUM(CASE WHEN txn_type = 'withdrawal' THEN txn_amount ELSE 0 END) AS bal
  FROM customer_transactions
  WHERE strftime('%Y', txn_date) = '2020'
    AND txn_type IN ('deposit', 'withdrawal')
  GROUP BY customer_id, strftime('%Y-%m', txn_date)
),
monthly AS (
  SELECT ym,
         SUM(CASE WHEN bal > 0 THEN 1 ELSE 0 END) AS pos_customers,
         AVG(bal) AS avg_balance
  FROM cm
  GROUP BY ym
),
hi AS (SELECT ym, pos_customers, avg_balance FROM monthly ORDER BY pos_customers DESC, ym ASC LIMIT 1),
lo AS (SELECT ym, pos_customers, avg_balance FROM monthly ORDER BY pos_customers ASC, ym ASC LIMIT 1)
SELECT hi.ym AS highest_month,
       hi.pos_customers AS highest_month_positive_customers,
       ROUND(hi.avg_balance, 2) AS highest_month_avg_balance,
       lo.ym AS lowest_month,
       lo.pos_customers AS lowest_month_positive_customers,
       ROUND(lo.avg_balance, 2) AS lowest_month_avg_balance,
       ROUND(hi.avg_balance - lo.avg_balance, 2) AS avg_balance_difference
FROM hi CROSS JOIN lo
