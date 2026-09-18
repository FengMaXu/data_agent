SELECT SUM(
         CASE co.pizza_id WHEN 1 THEN 12 WHEN 2 THEN 10 END
       + CASE WHEN co.extras IS NULL OR TRIM(co.extras) = '' THEN 0
              ELSE LENGTH(TRIM(co.extras)) - LENGTH(REPLACE(TRIM(co.extras), ',', '')) + 1
         END
       ) AS total_income
FROM pizza_clean_customer_orders co
JOIN pizza_clean_runner_orders ro ON ro.order_id = co.order_id
WHERE ro.cancellation IS NULL
  AND co.pizza_id IN (1, 2);
