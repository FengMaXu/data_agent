#!/usr/bin/env bash
set -u
ROOT="D:/data_agent"
CONFIG=".artifacts/answer-plan-phase6-new-on.json"
IDS="evaluations/spider2/official-gold-correct-116-ids.txt"
RUN_ID="answer-plan-new-on-deepseek-official-gold116-r1"
LOG=".artifacts/answer-plan-phase6/official-gold-116-deepseek/resume-original/resume-loop-3parallel.log"
MAX_ATTEMPTS=20
cd "$ROOT" || exit 2
: > "$LOG"
for attempt in $(seq 1 "$MAX_ATTEMPTS"); do
  {
    echo "===== resume attempt ${attempt}/${MAX_ATTEMPTS} $(date -Iseconds) ====="
    npm run eval:spider2 -- run \
      --config "$CONFIG" \
      --ids-file "$IDS" \
      --model-profile deepseek \
      --run-id "$RUN_ID" \
      --resume \
      --concurrency 3 \
      --formal \
      --score
    rc=$?
    echo "===== attempt ${attempt} exit=${rc} $(date -Iseconds) ====="
  } >> "$LOG" 2>&1
  if [ "$rc" -eq 0 ]; then
    echo 0 > .artifacts/answer-plan-phase6/official-gold-116-deepseek/resume-original/resume-loop-exit
    touch .artifacts/answer-plan-phase6/official-gold-116-deepseek/resume-original/resume-loop-complete
    exit 0
  fi
  sleep 8
done
echo 1 > .artifacts/answer-plan-phase6/official-gold-116-deepseek/resume-original/resume-loop-exit
exit 1
