# HEARTBEAT.md

## 正常運作中

定期檢查項目（輪流，每天 2-4 次）：
- EClaw Dashboard 狀態
- Kanban 卡片進度
- Bot 回報 / 驗收待辦

## 快速健康檢查

```bash
curl -s http://localhost:8787/ > /dev/null && echo "fakechat OK" || echo "fakechat DOWN"
curl -s http://localhost:18800/health
tmux has-session -t eclaw-bot 2>/dev/null && echo "eclaw-bot OK" || echo "eclaw-bot MISSING"
```

## Bot 沒回應？

Dashboard → 編輯 → 重新連線（自動觸發 `/restart`，~3 秒回來）
