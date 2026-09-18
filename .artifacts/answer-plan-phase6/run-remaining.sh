#!/usr/bin/env bash
set -u
ROOT=D:/data_agent
LOG=$ROOT/.artifacts/answer-plan-phase6/runs
wait_rep() {
  local rep=$1
  while [ ! -f "$LOG/legacy-r${rep}.exit" ] || [ ! -f "$LOG/new-off-r${rep}.exit" ] || [ ! -f "$LOG/new-on-r${rep}.exit" ]; do sleep 30; done
  for arm in legacy new-off new-on; do
    if [ "$(cat "$LOG/$arm-r${rep}.exit")" != 0 ]; then echo "rep $rep arm $arm failed" > "$LOG/supervisor.failed"; exit 1; fi
  done
}
launch_rep() {
  local rep=$1
  (cd D:/data_agent_phase6_control && npm run eval:spider2 -- run --config phase6-config.json --ids-file evaluations/spider2/phase6-frozen-100-ids.txt --model-profile gpt-5.5 --run-id answer-plan-phase6-gpt55-v3-legacy-r${rep} --formal --score > "$LOG/legacy-r${rep}.log" 2>&1; echo $? > "$LOG/legacy-r${rep}.exit") & p1=$!
  (cd D:/data_agent && npm run eval:spider2 -- run --config .artifacts/answer-plan-phase6-new-off.json --ids-file evaluations/spider2/phase6-frozen-100-ids.txt --model-profile gpt-5.5 --run-id answer-plan-phase6-gpt55-v3-new-off-r${rep} --formal --score > "$LOG/new-off-r${rep}.log" 2>&1; echo $? > "$LOG/new-off-r${rep}.exit") & p2=$!
  (cd D:/data_agent && npm run eval:spider2 -- run --config .artifacts/answer-plan-phase6-new-on.json --ids-file evaluations/spider2/phase6-frozen-100-ids.txt --model-profile gpt-5.5 --run-id answer-plan-phase6-gpt55-v3-new-on-r${rep} --formal --score > "$LOG/new-on-r${rep}.log" 2>&1; echo $? > "$LOG/new-on-r${rep}.exit") & p3=$!
  wait $p1 $p2 $p3
}
wait_rep 1
launch_rep 2
wait_rep 2
launch_rep 3
wait_rep 3
echo complete > "$LOG/supervisor.complete"
