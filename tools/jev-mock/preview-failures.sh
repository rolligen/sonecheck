#!/usr/bin/env bash
#
# 降级全谱引导循环 —— `docs/versions/v0.1.1-honest-jev/200-spec.md` §5.4 的可执行形态。
#
# 存在的理由：文档里的内联 bash 块需要整块粘贴，而整块粘贴在 zsh 下
# 容易踩两类坑——注释行被当命令执行、`read` 提示语法在 bash 与 zsh 之间
# 不兼容（`read -r "提示语" 变量名` 只在部分 shell 可用，`read -r "提示语"`
# 在 zsh 下直接报 `not an identifier`）。落成文件后这些风险消失。
#
#   ./tools/jev-mock/preview-failures.sh
#
# 每轮：重启带预设故障的 mock → 提示观察界面 → 打印该轮期望文案 → 取证。
# `/stats` 必须在下一轮 `pkill` 之前读——计数是 handler.mjs 的模块级变量，
# 进程重启即归零。

set -u

cd "$(dirname "$0")/../.."

FAULTS=(disconnect timeout http500 unauthorized forbidden rate429 rate529 badschema)

label_for() {
  case "$1" in
    disconnect)           echo "网络不可达" ;;
    timeout)              echo "服务超时" ;;
    http500)              echo "服务异常" ;;
    unauthorized)         echo "Key 或配额不可用" ;;
    forbidden)            echo "Key 或配额不可用" ;;
    rate429)              echo "Key 或配额不可用" ;;
    rate529)              echo "Key 或配额不可用" ;;
    badschema)            echo "响应不合规" ;;
    *)                    echo "<未知故障>" ;;
  esac
}

error_for() {
  case "$1" in
    disconnect)           echo "ERR-01" ;;
    timeout)              echo "ERR-02" ;;
    http500)              echo "ERR-03" ;;
    unauthorized|forbidden|rate429|rate529) echo "ERR-04" ;;
    badschema)            echo "ERR-05" ;;
    *)                    echo "<未知>" ;;
  esac
}

printf '\n'
printf '══ 降级全谱引导循环 ══\n'
printf '每轮请在 sonedemo 窗口跑一次 SoneCheck: Inspect Staged Diff，\n'
printf '观察【右上角通知弹窗】的归因标签 + 【左下状态栏】的「已跳过」。\n'
printf '状态栏只显示「已跳过」四字，不含原因——原因只在通知弹窗里。\n\n'

for fault in "${FAULTS[@]}"; do
  pkill -f jev-mock/local.mjs >/dev/null 2>&1 || true
  sleep 0.5
  MOCK_FAULT="$fault" PORT=8787 node tools/jev-mock/local.mjs >/dev/null 2>&1 &
  sleep 1

  printf '┌─ 故障 %-13s %s\n' "$fault" "$(error_for "$fault")"
  printf '│  期望弹窗：SoneCheck: 已跳过 13 块改动（%s）\n' "$(label_for "$fault")"
  printf '│\n'
  printf '│  现在跑一次 Inspect Staged Diff，然后回车继续 ───\n'

  read -r _ || true

  printf '└─ 上游侧证据（下一轮 pkill 前读完）：\n'
  curl -s http://127.0.0.1:8787/stats
  printf '\n\n'
done

printf '八轮跑完。恢复无故障 mock：\n'
printf '  pkill -f jev-mock/local.mjs\n'
printf '  MOCK_LATENCY_MS=100 PORT=8787 node tools/jev-mock/local.mjs &\n\n'