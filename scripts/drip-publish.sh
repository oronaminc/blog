#!/bin/bash
# 트렌드 기사를 한 편씩 천천히(간격 두고) 발행. 차단(403)이면 대기 후 재시도.
# 차단이 풀리는 즉시(본인확인/시간경과) 자동으로 나머지가 순차 발행된다.
cd /Users/1113177/Desktop/github/blog
GAP=${GAP:-240}        # 성공 후 대기(초) = 4분
BLOCKGAP=${BLOCKGAP:-300}  # 차단 시 대기(초) = 5분
MAXITER=${MAXITER:-45}
LOG=/private/tmp/claude-690967281/-Users-1113177-Desktop-github-blog/05af997d-f51e-4886-b83f-398d0330ceac/scratchpad/drip.log
echo "=== drip 시작 $(date) ===" >> "$LOG"

for i in $(seq 1 $MAXITER); do
  OUT=$(node --env-file=.env scripts/publish-one.mjs 2>&1)
  STAMP=$(date +%H:%M:%S)
  LINE=$(echo "$OUT" | grep -E "ALL_DONE|ONE_OK|BLOCKED|ERROR|발행" | head -1)
  echo "[$STAMP] ($i) $LINE" >> "$LOG"

  if echo "$OUT" | grep -q "ALL_DONE"; then
    git add .publish-state.json 2>/dev/null && git commit -q -m "chore: 발행 상태 업데이트 [skip ci]" 2>/dev/null && git push -q 2>/dev/null
    echo "[$STAMP] === 전부 발행 완료 ===" >> "$LOG"
    break
  elif echo "$OUT" | grep -q "ONE_OK"; then
    git add .publish-state.json 2>/dev/null && git commit -q -m "chore: 발행 상태 업데이트 [skip ci]" 2>/dev/null && git push -q 2>/dev/null
    sleep "$GAP"
  elif echo "$OUT" | grep -q "NEEDS_SMS"; then
    echo "[$STAMP] !! SMS 본인확인 재요구 — 드립 중단(사용자 조치 필요) !!" >> "$LOG"
    break
  else
    sleep "$BLOCKGAP"
  fi
done
echo "[$(date +%H:%M:%S)] drip 종료" >> "$LOG"
