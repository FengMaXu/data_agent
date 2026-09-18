SELECT L1_model, COUNT(*) AS total_count
FROM (
    SELECT L1_model FROM model
    UNION ALL
    SELECT L1_model FROM stack_ok
)
GROUP BY L1_model
ORDER BY total_count DESC, L1_model ASC
LIMIT 1
