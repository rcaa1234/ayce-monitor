---
description: 簡化發文排程系統，移除 UCB 多模板，改為單一提示詞
---

# 簡化發文排程系統

## 修改範圍

### 1. 前端 (public/index.html)

#### 主分頁
- 總覽 → 保留
- 發文排程 → 修改子分頁
- 模板設定 → **改為「提示詞設定」**
- 帳號管理 → 保留（文字調整）

#### 發文排程子分頁
- UCB智能排程 → **改為「AI發文」**（簡化設定）
- 手動建立 → **改為「預約發文」**
- 排程中貼文 → 保留

#### AI發文設定項目（簡化版）
- 每日發文次數
- 發文時段開始時間
- 發文時段結束時間  
- 啟用星期
- 啟用/停用自動排程
- 測試發送按鈕

#### 提示詞設定（原模板設定）
- 單一提示詞編輯區
- AI 引擎選擇
- 儲存按鈕
- 測試生成按鈕

#### 統計分類
- AI發 (is_ai_generated = true)
- 非AI(含圖) (is_ai_generated = false AND media_type IS NOT NULL)
- 非AI(無圖) (is_ai_generated = false AND media_type IS NULL)

### 2. 後端修改

#### 資料庫
- 使用 smart_schedule_config 表儲存單一提示詞配置
- 新增欄位: ai_prompt, ai_engine

#### API 調整
- GET/PUT /api/ai-config - AI發文配置
- 排程邏輯改用單一提示詞

### 3. 移除/簡化的項目
- UCB 多模板選擇邏輯
- 模板表現排行
- 模板選擇器
- 探索係數/最少試驗次數等 UCB 參數

## 執行步驟

// turbo-all

1. 修改 smart_schedule_config 表結構（新增 ai_prompt, ai_engine 欄位）
2. 修改前端 HTML - 發文排程子分頁
3. 修改前端 HTML - 提示詞設定頁面
4. 修改前端 HTML - 帳號管理頁面文字
5. 修改前端 JS - AI發文配置讀取/儲存
6. 修改後端 - 排程邏輯改用單一提示詞
7. 修改統計分類邏輯
8. 測試並提交
