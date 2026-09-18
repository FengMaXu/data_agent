WITH helmet_status AS (
    SELECT DISTINCT case_id, 'wearing helmet' AS helmet_usage
    FROM parties
    WHERE case_id IS NOT NULL
      AND (party_safety_equipment_1 LIKE '%motorcycle helmet used%'
        OR party_safety_equipment_2 LIKE '%motorcycle helmet used%')
    UNION
    SELECT DISTINCT case_id, 'not wearing helmet' AS helmet_usage
    FROM parties
    WHERE case_id IS NOT NULL
      AND (party_safety_equipment_1 LIKE '%motorcycle helmet not used%'
        OR party_safety_equipment_2 LIKE '%motorcycle helmet not used%')
),
moto_collisions AS (
    SELECT case_id, motorcyclist_killed_count
    FROM collisions
    WHERE motorcycle_collision = 1
)
SELECT
    hs.helmet_usage AS helmet_usage,
    ROUND(100.0 * SUM(mc.motorcyclist_killed_count) / COUNT(DISTINCT hs.case_id), 2) AS fatality_rate_percent
FROM helmet_status hs
JOIN moto_collisions mc ON mc.case_id = hs.case_id
GROUP BY hs.helmet_usage
ORDER BY CASE hs.helmet_usage WHEN 'wearing helmet' THEN 1 ELSE 2 END
