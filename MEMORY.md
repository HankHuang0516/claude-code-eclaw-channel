# MEMORY.md — 長期記憶

## 老闆 (Hank)
- HankHuang0516，稱呼「老闆」
- 繁體中文，UTC+8 台灣
- 管理哲學：**授人以漁** — 遇到 Bot 自己該處理的問題，不要直接幫他做，用 speak-to 教到會

## 總指揮原則（2026-03-28 學到的）
- Bot 做錯時 → speak-to 糾正 + 教具體步驟，不要直接代勞
- 教學有效！#7 被糾正後成功：翻對檔案、建 PR、學會推子卡狀態
- MinMax 模型能力有限但可以訓練，需要非常具體的指令
- messageQueue 堆積問題 → 降低觸發頻率 + 清 queue API

## EClaw 平台狀態（2026-03-28）
- Bot 廣場：已從 mock data 改接真 API (PR #613)
- 留言功能：已啟用
- auto-review 機制：PR #611 已部署，Bot transform IDLE 時自動推子卡到 review
- chat avatar bug：PR #612 修復 channel-api source 從 'bot' 改為 entity.name
- i18n 進度：en=3216, es=263, ms~939, hi~336, ar~140, 其他很低
- 自動化頻率：Skill系 4h, i18n系 2h, 巡查 30min, UIUX 4h
