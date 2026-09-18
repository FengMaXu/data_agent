WITH clean_movies AS (
    SELECT CAST(year AS INTEGER) AS y
    FROM Movie
    WHERE year GLOB '[0-9][0-9][0-9][0-9]'
),
start_years AS (
    SELECT DISTINCT y AS start_year
    FROM clean_movies
),
window_counts AS (
    SELECT s.start_year AS start_year,
           COUNT(*) AS film_count
    FROM start_years s
    JOIN clean_movies m
      ON m.y >= s.start_year AND m.y <= s.start_year + 9
    GROUP BY s.start_year
)
SELECT start_year, film_count
FROM window_counts
ORDER BY film_count DESC, start_year ASC
LIMIT 1
