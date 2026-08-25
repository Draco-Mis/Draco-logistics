# Draco LOP — 登泰國際物流營運管理平台

*Draco Logistic Operation Platform · 登泰國際物流股份有限公司*

## 開發環境啟動

### 使用方式

在專案根目錄的終端機輸入：

```bash
./start-crm.sh
```

腳本會自動檢查 tmux 是否安裝、是否已有 `crm` session，並在需要時建立新 session 並啟動 Claude Code。

### 常用 tmux 指令

| 指令 | 說明 |
| --- | --- |
| `tmux ls` | 列出所有 session |
| `tmux attach -t crm` | 重新接上 `crm` session |
| `Ctrl+B` 然後按 `D` | 離開但保留 session 在背景執行 |
| `tmux kill-session -t crm` | 完全關閉 `crm` session |

### 注意事項

- Mac 闔上蓋子進入休眠時，tmux session 內的程序會被凍結（不會繼續執行）。
- 關電腦或重啟前，務必先 `git commit` 並 `git push`，避免遺失工作進度。
- 第一次使用前如果沒有 tmux，請先安裝：`brew install tmux`。
