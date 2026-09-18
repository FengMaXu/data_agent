#!/usr/bin/env bash
set -u
ROOT=D:/data_agent
LOG=$ROOT/.artifacts/answer-plan-phase6/v4-runs
mkdir -p "$LOG"
launch_rep() {
  local rep=$1
  (cd D:/data_agent_phase6_control && npm run eval:spider2 -- run --config phase6-config.json --ids-file evaluations/spider2/phase6-frozen-100-ids.txt --model-profile gpt-5.5 --run-id answer-plan-phase6-gpt55-v4-legacy-r${rep} --formal --score > "$LOG/legacy-r${rep}.log" 2>&1; echo $? > "$LOG/legacy-r${rep}.exit") & p1=$!
  (cd D:/data_agent && npm run eval:spider2 -- run --config .artifacts/answer-plan-phase6-new-off.json --ids-file evaluations/spider2/phase6-frozen-100-ids.txt --model-profile gpt-5.5 --run-id answer-plan-phase6-gpt55-v4-new-off-r${rep} --formal --score > "$LOG/new-off-r${rep}.log" 2>&1; echo $? > "$LOG/new-off-r${rep}.exit") & p2=$!
  (cd D:/data_agent && npm run eval:spider2 -- run --config .artifacts/answer-plan-phase6-new-on.json --ids-file evaluations/spider2/phase6-frozen-100-ids.txt --model-profile gpt-5.5 --run-id answer-plan-phase6-gpt55-v4-new-on-r${rep} --formal --score > "$LOG/new-on-r${rep}.log" 2>&1; echo $? > "$LOG/new-on-r${rep}.exit") & p3=$!
  wait $p1; e1=$?; wait $p2; e2=$?; wait $p3; e3=$?
  if [ "$e1" != 0 ] || [ "$e2" != 0 ] || [ "$e3" != 0 ]; then echo "rep=$rep legacy=$e1 off=$e2 on=$e3" > "$LOG/supervisor.failed"; exit 1; fi
}
for rep in 1 2 3; do launch_rep "$rep"; done
echo complete > "$LOG/supervisor.complete"
