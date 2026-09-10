# 后台常驻（目标 ≥ 24h）：P0.0 非评测探针
# 用法：bash research/source-probe/run-24h.sh [--interval-ms 60000]
# 停止：kill <pid> 或 jobs 查 data/runner-*.log 对应进程；SIGINT 会触发 summary 写入。
set -euo pipefail
cd "$(dirname "$0")/../.."
INTERVAL="${1:---interval-ms}"
mkdir -p research/source-probe/data
STAMP="$(date -u +%Y%m%d-%H%M%SZ)"
LOG="research/source-probe/data/runner-${STAMP}.log"
echo "[run-24h] starting, log=${LOG}"
# shellcheck disable=SC2086
nohup npx tsx research/source-probe/probe.ts ${INTERVAL} > "${LOG}" 2>&1 &
echo "[run-24h] pid=$! log=${LOG}"
echo "[run-24h] NOTE: probe data 禁入评测，仅用于 cadence 基线冻结。"
