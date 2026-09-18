WITH appearances AS (
  SELECT id AS match_id, home_player_1 AS player_api_id, 'home' AS side, home_team_goal AS hg, away_team_goal AS ag FROM Match
  UNION ALL SELECT id, home_player_2, 'home', home_team_goal, away_team_goal FROM Match
  UNION ALL SELECT id, home_player_3, 'home', home_team_goal, away_team_goal FROM Match
  UNION ALL SELECT id, home_player_4, 'home', home_team_goal, away_team_goal FROM Match
  UNION ALL SELECT id, home_player_5, 'home', home_team_goal, away_team_goal FROM Match
  UNION ALL SELECT id, home_player_6, 'home', home_team_goal, away_team_goal FROM Match
  UNION ALL SELECT id, home_player_7, 'home', home_team_goal, away_team_goal FROM Match
  UNION ALL SELECT id, home_player_8, 'home', home_team_goal, away_team_goal FROM Match
  UNION ALL SELECT id, home_player_9, 'home', home_team_goal, away_team_goal FROM Match
  UNION ALL SELECT id, home_player_10, 'home', home_team_goal, away_team_goal FROM Match
  UNION ALL SELECT id, home_player_11, 'home', home_team_goal, away_team_goal FROM Match
  UNION ALL SELECT id, away_player_1, 'away', home_team_goal, away_team_goal FROM Match
  UNION ALL SELECT id, away_player_2, 'away', home_team_goal, away_team_goal FROM Match
  UNION ALL SELECT id, away_player_3, 'away', home_team_goal, away_team_goal FROM Match
  UNION ALL SELECT id, away_player_4, 'away', home_team_goal, away_team_goal FROM Match
  UNION ALL SELECT id, away_player_5, 'away', home_team_goal, away_team_goal FROM Match
  UNION ALL SELECT id, away_player_6, 'away', home_team_goal, away_team_goal FROM Match
  UNION ALL SELECT id, away_player_7, 'away', home_team_goal, away_team_goal FROM Match
  UNION ALL SELECT id, away_player_8, 'away', home_team_goal, away_team_goal FROM Match
  UNION ALL SELECT id, away_player_9, 'away', home_team_goal, away_team_goal FROM Match
  UNION ALL SELECT id, away_player_10, 'away', home_team_goal, away_team_goal FROM Match
  UNION ALL SELECT id, away_player_11, 'away', home_team_goal, away_team_goal FROM Match
),
decided AS (
  SELECT DISTINCT match_id, player_api_id,
    CASE WHEN (side = 'home' AND hg > ag) OR (side = 'away' AND ag > hg) THEN 'win' ELSE 'loss' END AS outcome
  FROM appearances
  WHERE player_api_id IS NOT NULL AND hg IS NOT NULL AND ag IS NOT NULL AND hg <> ag
),
player_counts AS (
  SELECT player_api_id,
    SUM(CASE WHEN outcome = 'win' THEN 1 ELSE 0 END) AS winning_matches,
    SUM(CASE WHEN outcome = 'loss' THEN 1 ELSE 0 END) AS losing_matches
  FROM decided
  GROUP BY player_api_id
),
extremes AS (
  SELECT MAX(winning_matches) AS max_wins, MAX(losing_matches) AS max_losses
  FROM player_counts
),
selected AS (
  SELECT 'winning' AS result_type, pc.player_api_id, pc.winning_matches AS match_count
  FROM player_counts pc CROSS JOIN extremes e
  WHERE pc.winning_matches = e.max_wins
  UNION ALL
  SELECT 'losing', pc.player_api_id, pc.losing_matches
  FROM player_counts pc CROSS JOIN extremes e
  WHERE pc.losing_matches = e.max_losses
)
SELECT s.result_type, p.player_name, s.match_count
FROM selected s
JOIN Player p ON p.player_api_id = s.player_api_id
ORDER BY CASE s.result_type WHEN 'winning' THEN 0 ELSE 1 END, s.match_count DESC, p.player_name
