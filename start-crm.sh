#!/bin/bash

SESSION_NAME="crm"
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "============================================"
echo "  CRM 開發環境啟動器"
echo "============================================"
echo "操作說明："
echo "  - Ctrl+B 然後按 D：離開但保留 session 在背景"
echo "  - tmux attach -t ${SESSION_NAME}：重新接回 session"
echo "  - tmux ls：列出所有 session"
echo "  - tmux kill-session -t ${SESSION_NAME}：完全關閉 session"
echo "============================================"
echo ""

if ! command -v tmux >/dev/null 2>&1; then
  echo "❌ 偵測不到 tmux，請先安裝："
  echo "   brew install tmux"
  exit 1
fi

if tmux has-session -t "${SESSION_NAME}" 2>/dev/null; then
  echo "✅ 偵測到既有的 '${SESSION_NAME}' session，正在 attach..."
  tmux attach -t "${SESSION_NAME}"
else
  echo "🚀 建立新的 '${SESSION_NAME}' session 並啟動 Claude Code..."
  tmux new-session -s "${SESSION_NAME}" -c "${PROJECT_DIR}" "claude"
fi
