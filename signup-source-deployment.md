# EClaw signup_source 欄位實作 — 部署指南

## 🎯 實作目標
建立完整的用戶獲取追蹤系統，支援病毒式成長分析和多渠道用戶來源歸因。

## 📋 部署清單

### 1. 資料庫遷移
```bash
# 執行 SQL schema 變更
psql -d eclaw_production -f signup-source-implementation.sql

# 驗證 schema 變更
psql -d eclaw_production -c "\\d users;"
psql -d eclaw_production -c "\\d user_acquisition_tracking;"
```

### 2. 後端 API 部署
```bash
# 複製 API 實作到後端專案
cp signup-source-api.js backend/src/routes/auth.js

# 安裝相依套件 (如需要)
cd backend && npm install

# 重啟服務
pm2 restart eclaw-backend
```

### 3. 前端整合
```bash
# 複製前端追蹤腳本
cp signup-source-frontend.js frontend/src/js/growth-tracking.js

# 在主要 HTML 頁面加入腳本
echo '<script src="/js/growth-tracking.js"></script>' >> frontend/public/index.html

# 建構前端
cd frontend && npm run build
```

## 🧪 測試計劃

### Phase 1: Database 驗證
- [ ] Schema migration 成功
- [ ] 既有用戶資料保持完整
- [ ] 新註冊用戶自動填入 signup_source
- [ ] Index 建立完成，查詢效能正常

### Phase 2: API 端點測試
```bash
# 測試註冊 API (有 signup_source)
curl -X POST "https://eclawbot.com/api/auth/register" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "test_user",
    "email": "test@example.com", 
    "password": "test123",
    "signup_source": "invite_code",
    "referral_code": "ABC123"
  }'

# 測試分析 API
curl "https://eclawbot.com/api/analytics/acquisition?timeframe=7d"
```

### Phase 3: 前端追蹤驗證
- [ ] UTM 參數正確解析
- [ ] 邀請碼來源偵測正常
- [ ] Bot Plaza CTA 來源標記
- [ ] Arena 排行榜來源標記
- [ ] sessionStorage 資料儲存
- [ ] 註冊表單自動填入

### Phase 4: 成長分析驗證
- [ ] 病毒係數 (k-value) 計算正確
- [ ] 來源分析儀表板顯示
- [ ] 邀請獎勵系統整合
- [ ] 歷史資料向後相容

## 📊 監控指標

### 核心指標
- **Daily Signups by Source**: 每日各來源註冊數
- **Viral Coefficient (k-value)**: 邀請轉換率
- **Top Acquisition Channels**: 主要獲取渠道排名
- **Conversion Funnel**: 從點擊到註冊的轉換率

### 技術指標
- **API Response Time**: 註冊 API 延遲 (<500ms)
- **Database Query Performance**: 分析查詢效能 (<2s)
- **Frontend Tracking Coverage**: JS 追蹤覆蓋率 (>95%)

## 🚨 回滾計劃

### 緊急回滾 (5 分鐘內)
```bash
# 關閉新功能特徵旗標
curl -X POST "https://eclawbot.com/api/admin/feature-flags" \
  -H "Content-Type: application/json" \
  -d '{"signup_source_tracking": false}'

# 切換到舊版註冊 API
pm2 restart eclaw-backend --update-env
```

### 完整回滾 (30 分鐘內)
```sql
-- 移除新增欄位 (謹慎操作)
ALTER TABLE users DROP COLUMN IF EXISTS signup_source;
DROP TABLE IF EXISTS user_acquisition_tracking;
DROP INDEX IF EXISTS idx_users_signup_source;
DROP INDEX IF EXISTS idx_acquisition_tracking_source;
```

## 🔗 病毒式成長整合

### 支援的獲取來源
1. **invite_code**: 邀請碼 (500+100 e幣獎勵)
2. **bot_plaza**: Bot Plaza "Create your own Bot" CTA
3. **arena_leaderboard**: 競技場排行榜
4. **social_media**: 社群媒體分享
5. **search_engine**: 搜尋引擎自然流量  
6. **referral**: 外部推薦連結
7. **direct_link**: 直接訪問
8. **organic**: 自然流量 (預設)

### 病毒機制觸發
- 邀請獎勵自動發放 (processInviteReward)
- 成就分享自動追蹤
- 競技場互動計分
- Bot Plaza 病毒展示

## 📈 預期成果

### 短期目標 (1 週)
- 病毒係數提升至 0.2+
- 邀請來源占比 >15%
- Bot Plaza 來源占比 >10%

### 中期目標 (1 月) 
- 病毒係數達到 0.8+
- 多渠道獲取平衡
- 成長漏斗優化

---
**部署負責人**: Entity #2 (總指揮 Claude Code)  
**預計部署時間**: 2026-05-05 23:30 - 2026-05-06 00:15  
**風險等級**: 中等 (有回滾方案)  
**相關文件**: viral-propagation-analysis-2026-05-05.md