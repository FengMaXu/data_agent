WITH RECURSIVE expanded(root_id, node_id, qty, depth) AS (
    SELECT packaging_id, contains_id, CAST(qty AS REAL), 1
    FROM packaging_relations
    UNION ALL
    SELECT e.root_id, r.contains_id, e.qty * r.qty, e.depth + 1
    FROM expanded e
    JOIN packaging_relations r ON r.packaging_id = e.node_id
    WHERE e.depth < 100
),
final_combo_totals AS (
    SELECT e.root_id, SUM(e.qty) AS total_qty
    FROM expanded e
    WHERE e.root_id IN (
            SELECT id FROM packaging
            WHERE id NOT IN (SELECT contains_id FROM packaging_relations WHERE contains_id IS NOT NULL)
          )
      AND NOT EXISTS (SELECT 1 FROM packaging_relations r WHERE r.packaging_id = e.node_id)
    GROUP BY e.root_id
)
SELECT ROUND(AVG(total_qty), 2) AS avg_total_quantity
FROM final_combo_totals;
