WITH cleaned AS (
  SELECT
    ticker,
    market_date,
    substr(market_date,7,4) || '-' || substr(market_date,4,2) || '-' || substr(market_date,1,2) AS iso_date,
    CASE
      WHEN TRIM(COALESCE(volume,'')) = '-' THEN 0.0
      WHEN UPPER(substr(TRIM(volume), -1)) = 'K' THEN CAST(REPLACE(REPLACE(REPLACE(TRIM(volume),'K',''),'k',''),',','') AS REAL) * 1000.0
      WHEN UPPER(substr(TRIM(volume), -1)) = 'M' THEN CAST(REPLACE(REPLACE(REPLACE(TRIM(volume),'M',''),'m',''),',','') AS REAL) * 1000000.0
      ELSE CAST(REPLACE(TRIM(volume), ',', '') AS REAL)
    END AS volume_num
  FROM bitcoin_prices
),
with_prev AS (
  SELECT
    ticker, market_date, iso_date, volume_num,
    MAX(CASE WHEN volume_num > 0 THEN iso_date END) OVER (
      PARTITION BY ticker ORDER BY iso_date
      ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
    ) AS prev_nz_date
  FROM cleaned
),
windowed AS (
  SELECT w.ticker, w.market_date, w.iso_date, w.volume_num, p.volume_num AS prev_volume
  FROM with_prev w
  LEFT JOIN cleaned p
    ON p.ticker = w.ticker AND p.iso_date = w.prev_nz_date
  WHERE w.iso_date >= '2021-08-01' AND w.iso_date <= '2021-08-10'
)
SELECT
  ticker,
  market_date,
  100.0 * (volume_num - prev_volume) / prev_volume AS volume_pct_change
FROM windowed
WHERE prev_volume IS NOT NULL
ORDER BY ticker, iso_date
