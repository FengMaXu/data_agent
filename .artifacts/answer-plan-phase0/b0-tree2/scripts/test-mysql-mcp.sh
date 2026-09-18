#!/usr/bin/env bash
# Disposable MySQL contract-test harness for the MySQL Reference MCP Server pack.
# Starts an isolated mysqld on a scratch datadir, seeds fixtures, runs contract tests,
# then shuts the server down.
set -euo pipefail

MYSQLD="${1:-C:/Users/Negan/AppData/Local/mysql-8.0.26-winx64/mysql-8.0.26-winx64/bin/mysqld.exe}"
BIN="$(dirname "$MYSQLD")"
MYSQL="$BIN/mysql.exe"
MYSQLADMIN="$BIN/mysqladmin.exe"
PORT="${DATA_AGENT_MYSQL_PORT:-13312}"
BASE="$(mktemp -d)"
DATA=$(cygpath -w "$BASE/data")

echo "[mysql-contract] data dir: $DATA"
"$MYSQLD" --no-defaults --initialize-insecure --datadir="$DATA" --console >/dev/null 2>&1

nohup "$MYSQLD" --no-defaults --datadir="$DATA" --port="$PORT" --bind-address=127.0.0.1 \
  --skip-networking=OFF --console >"$BASE/out.log" 2>&1 </dev/null &
for _ in $(seq 1 120); do
  if (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null; then exec 3>&- 3<&-; break; fi
  sleep 0.5
done

"$MYSQL" --no-defaults -h 127.0.0.1 -P "$PORT" -u root \
  -e "CREATE DATABASE IF NOT EXISTS data_agent_contract; USE data_agent_contract; CREATE TABLE IF NOT EXISTS contract_sales (id INT PRIMARY KEY, region VARCHAR(50), amount DECIMAL(12,2)); TRUNCATE contract_sales; INSERT INTO contract_sales VALUES (1,'north',10),(2,'south',20);"

set +e
DATA_AGENT_TEST_MYSQL=1 DATA_AGENT_MYSQL_PORT="$PORT" DATA_AGENT_MYSQL_DATABASE=data_agent_contract \
  npx vitest run packages/mcp-mysql/src/contract.test.ts --root .
STATUS=$?
set -e

"$MYSQLADMIN" --no-defaults -h 127.0.0.1 -P "$PORT" -u root shutdown || true
echo "[mysql-contract] done status=$STATUS"
exit "$STATUS"
