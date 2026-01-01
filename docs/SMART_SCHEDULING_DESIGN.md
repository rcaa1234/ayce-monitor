# 🤖 AI 智能排程系統設計文檔

## 📋 目標

建立一個能夠自動學習並優化發文時段的系統，針對不同類型的內容找出最佳發布時間。

---

## 🎯 核心策略：Contextual Multi-Armed Bandit

### 為什麼選這個算法？

1. **平衡探索與利用** - 既要嘗試新時段，也要使用已知最佳時段
2. **即時學習** - 每次發文都更新模型
3. **上下文感知** - 考慮內容類型、星期、節日等因素
4. **簡單高效** - 不需要大量歷史數據就能運作

---

## 📊 數據架構

### 新增表 1: `content_categories`（內容分類）

```sql
CREATE TABLE content_categories (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  description TEXT,
  prompt_template TEXT,
  keywords JSON, -- ["勵志", "早安", "正能量"]
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
```

**範例數據：**
```sql
INSERT INTO content_categories (id, name, description, prompt_template, keywords) VALUES
('cat-001', '勵志激勵', '早晨正能量文章', '寫一篇充滿正能量的早安文...', '["勵志", "早安", "正能量"]'),
('cat-002', '知識分享', '實用知識和技巧', '分享一個{topic}相關的實用知識...', '["知識", "學習", "技巧"]'),
('cat-003', '娛樂輕鬆', '幽默有趣的內容', '寫一個輕鬆有趣的{topic}小故事...', '["幽默", "娛樂", "故事"]');
```

---

### 新增表 2: `time_slots`（時段定義）

```sql
CREATE TABLE time_slots (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(50) NOT NULL,
  hour INT NOT NULL, -- 0-23
  minute INT NOT NULL, -- 0-59
  day_of_week INT, -- 0-6 (0=Sunday), NULL=每天
  enabled BOOLEAN DEFAULT true,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

**範例數據：**
```sql
INSERT INTO time_slots (id, name, hour, minute, day_of_week) VALUES
('slot-001', '早晨黃金時段', 8, 0, NULL),
('slot-002', '午間休息', 12, 30, NULL),
('slot-003', '下午茶時光', 15, 0, NULL),
('slot-004', '晚間放鬆', 20, 0, NULL),
('slot-005', '週末早晨', 9, 30, 0),
('slot-006', '週末早晨', 9, 30, 6);
```

---

### 新增表 3: `slot_category_performance`（時段-分類表現追蹤）

```sql
CREATE TABLE slot_category_performance (
  id VARCHAR(36) PRIMARY KEY,
  time_slot_id VARCHAR(36) NOT NULL,
  category_id VARCHAR(36) NOT NULL,

  -- 統計數據
  total_posts INT DEFAULT 0,
  total_views INT DEFAULT 0,
  total_likes INT DEFAULT 0,
  total_replies INT DEFAULT 0,
  total_engagement INT DEFAULT 0,

  -- 平均表現
  avg_views DECIMAL(10,2) DEFAULT 0,
  avg_likes DECIMAL(10,2) DEFAULT 0,
  avg_engagement_rate DECIMAL(5,2) DEFAULT 0,

  -- MAB 算法參數
  confidence_score DECIMAL(5,4) DEFAULT 0, -- 0-1，信心分數
  exploration_count INT DEFAULT 0, -- 探索次數
  last_selected_at DATETIME NULL,

  -- 時間加權平均（近期表現更重要）
  recent_performance_score DECIMAL(10,2) DEFAULT 0,

  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  FOREIGN KEY (time_slot_id) REFERENCES time_slots(id),
  FOREIGN KEY (category_id) REFERENCES content_categories(id),
  UNIQUE KEY uk_slot_category (time_slot_id, category_id),
  INDEX idx_performance (avg_engagement_rate DESC),
  INDEX idx_confidence (confidence_score DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

---

### 新增表 4: `scheduled_posts`（預定發文）

```sql
CREATE TABLE scheduled_posts (
  id VARCHAR(36) PRIMARY KEY,
  category_id VARCHAR(36) NOT NULL,
  time_slot_id VARCHAR(36) NOT NULL,
  scheduled_time DATETIME NOT NULL,

  post_id VARCHAR(36) NULL, -- 生成後關聯

  status ENUM('PENDING', 'GENERATED', 'POSTED', 'FAILED') DEFAULT 'PENDING',

  -- AI 選擇原因
  selection_reason ENUM('BEST_PERFORMANCE', 'EXPLORATION', 'RANDOM', 'MANUAL') DEFAULT 'BEST_PERFORMANCE',
  selection_score DECIMAL(10,4), -- UCB 分數

  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  FOREIGN KEY (category_id) REFERENCES content_categories(id),
  FOREIGN KEY (time_slot_id) REFERENCES time_slots(id),
  FOREIGN KEY (post_id) REFERENCES posts(id),
  INDEX idx_scheduled_time (scheduled_time),
  INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

---

## 🧮 核心算法：Upper Confidence Bound (UCB)

### UCB 公式

```
UCB Score = 平均表現 + c × √(ln(總嘗試次數) / 此選項嘗試次數)
```

其中：
- **平均表現** = 互動率的平均值（利用已知資訊）
- **探索獎勵** = c × √(ln(N) / n)（鼓勵嘗試次數少的選項）
- **c** = 探索係數（通常設為 1.5-2.0）

### TypeScript 實作

```typescript
interface SlotPerformance {
  slotId: string;
  categoryId: string;
  avgEngagementRate: number;
  totalPosts: number;
  confidenceScore: number;
}

class SmartScheduler {
  private explorationFactor = 1.8; // 可調整的探索係數

  /**
   * 使用 UCB 算法選擇最佳時段
   */
  async selectBestTimeSlot(
    categoryId: string,
    availableSlots: string[]
  ): Promise<{ slotId: string; reason: string; score: number }> {

    const performances = await this.getSlotPerformances(categoryId, availableSlots);
    const totalAttempts = performances.reduce((sum, p) => sum + p.totalPosts, 0);

    // 如果總嘗試次數太少，隨機探索
    if (totalAttempts < 10) {
      const randomSlot = availableSlots[Math.floor(Math.random() * availableSlots.length)];
      return {
        slotId: randomSlot,
        reason: 'EXPLORATION',
        score: 0
      };
    }

    // 計算每個時段的 UCB 分數
    let bestSlot = null;
    let bestScore = -Infinity;

    for (const perf of performances) {
      const explorationBonus = this.explorationFactor *
        Math.sqrt(Math.log(totalAttempts) / (perf.totalPosts || 1));

      const ucbScore = perf.avgEngagementRate + explorationBonus;

      if (ucbScore > bestScore) {
        bestScore = ucbScore;
        bestSlot = perf.slotId;
      }
    }

    return {
      slotId: bestSlot!,
      reason: 'BEST_PERFORMANCE',
      score: bestScore
    };
  }

  /**
   * 時間衰減加權（近期表現更重要）
   */
  private calculateTimeWeightedScore(posts: PostWithInsights[]): number {
    const now = Date.now();
    const weights = posts.map(post => {
      const ageInDays = (now - post.postedAt.getTime()) / (1000 * 60 * 60 * 24);
      const decayFactor = Math.exp(-ageInDays / 30); // 30 天半衰期
      return post.engagementRate * decayFactor;
    });

    return weights.reduce((sum, w) => sum + w, 0) / weights.length;
  }

  /**
   * 更新表現數據
   */
  async updatePerformance(
    postId: string,
    slotId: string,
    categoryId: string,
    insights: PostInsights
  ): Promise<void> {
    const pool = getPool();

    // 計算互動率
    const totalInteractions = insights.likes + insights.replies +
                              insights.reposts + insights.shares;
    const engagementRate = insights.views > 0
      ? (totalInteractions / insights.views) * 100
      : 0;

    // 更新統計數據（使用 SQL 聚合）
    await pool.execute(`
      INSERT INTO slot_category_performance (
        id, time_slot_id, category_id,
        total_posts, total_views, total_likes, total_replies,
        total_engagement, avg_engagement_rate
      )
      SELECT
        UUID() as id,
        ? as time_slot_id,
        ? as category_id,
        1 as total_posts,
        ? as total_views,
        ? as total_likes,
        ? as total_replies,
        ? as total_engagement,
        ? as avg_engagement_rate
      ON DUPLICATE KEY UPDATE
        total_posts = total_posts + 1,
        total_views = total_views + VALUES(total_views),
        total_likes = total_likes + VALUES(total_likes),
        total_replies = total_replies + VALUES(total_replies),
        total_engagement = total_engagement + VALUES(total_engagement),
        avg_engagement_rate = (avg_engagement_rate * total_posts + VALUES(avg_engagement_rate)) / (total_posts + 1),
        updated_at = CURRENT_TIMESTAMP
    `, [
      slotId, categoryId,
      insights.views, insights.likes, insights.replies,
      totalInteractions, engagementRate
    ]);

    // 更新信心分數（貝葉斯更新）
    await this.updateConfidenceScore(slotId, categoryId);
  }

  /**
   * 計算信心分數（Wilson Score）
   */
  private async updateConfidenceScore(slotId: string, categoryId: string): Promise<void> {
    const pool = getPool();

    // 獲取該時段-分類的所有貼文表現
    const [posts] = await pool.execute<RowDataPacket[]>(`
      SELECT pi.engagement_rate
      FROM scheduled_posts sp
      JOIN posts p ON sp.post_id = p.id
      JOIN post_insights pi ON p.id = pi.post_id
      WHERE sp.time_slot_id = ?
        AND sp.category_id = ?
        AND p.status = 'POSTED'
    `, [slotId, categoryId]);

    if (posts.length === 0) return;

    // 計算 Wilson Score Confidence Interval
    const n = posts.length;
    const successThreshold = 5.0; // 互動率 > 5% 視為成功
    const successes = posts.filter(p => p.engagement_rate > successThreshold).length;

    const phat = successes / n;
    const z = 1.96; // 95% 信心區間

    const confidenceScore = (phat + z*z/(2*n) - z * Math.sqrt((phat*(1-phat) + z*z/(4*n))/n)) / (1 + z*z/n);

    await pool.execute(`
      UPDATE slot_category_performance
      SET confidence_score = ?,
          exploration_count = exploration_count + 1
      WHERE time_slot_id = ? AND category_id = ?
    `, [confidenceScore, slotId, categoryId]);
  }
}
```

---

## 🔄 工作流程

### 1. 自動排程生成

```typescript
async function generateSmartSchedule(days: number = 7): Promise<void> {
  const scheduler = new SmartScheduler();

  // 獲取所有啟用的分類和時段
  const categories = await getEnabledCategories();
  const timeSlots = await getEnabledTimeSlots();

  const startDate = new Date();

  for (let day = 0; day < days; day++) {
    const currentDate = new Date(startDate);
    currentDate.setDate(startDate.getDate() + day);

    for (const category of categories) {
      // 過濾當天可用的時段
      const availableSlots = timeSlots.filter(slot => {
        if (slot.dayOfWeek !== null && slot.dayOfWeek !== currentDate.getDay()) {
          return false;
        }
        return true;
      });

      // AI 選擇最佳時段
      const selection = await scheduler.selectBestTimeSlot(
        category.id,
        availableSlots.map(s => s.id)
      );

      // 建立預定發文
      const scheduledTime = new Date(currentDate);
      scheduledTime.setHours(
        timeSlots.find(s => s.id === selection.slotId)!.hour,
        timeSlots.find(s => s.id === selection.slotId)!.minute,
        0, 0
      );

      await createScheduledPost({
        categoryId: category.id,
        timeSlotId: selection.slotId,
        scheduledTime,
        selectionReason: selection.reason,
        selectionScore: selection.score
      });
    }
  }
}
```

### 2. 定時執行（每分鐘檢查）

```typescript
export const smartScheduleExecutor = cron.schedule('* * * * *', async () => {
  const now = new Date();

  // 查詢需要執行的排程（容許 2 分鐘誤差）
  const [pending] = await pool.execute<RowDataPacket[]>(`
    SELECT sp.*, cc.prompt_template, cc.keywords
    FROM scheduled_posts sp
    JOIN content_categories cc ON sp.category_id = cc.id
    WHERE sp.status = 'PENDING'
      AND sp.scheduled_time <= DATE_ADD(?, INTERVAL 2 MINUTE)
      AND sp.scheduled_time >= DATE_SUB(?, INTERVAL 2 MINUTE)
  `, [now, now]);

  for (const schedule of pending) {
    // 生成內容
    const post = await PostModel.create({ created_by: systemUserId });

    await queueService.addGenerateJob({
      postId: post.id,
      stylePreset: schedule.prompt_template,
      keywords: JSON.parse(schedule.keywords)
    });

    // 更新排程狀態
    await pool.execute(`
      UPDATE scheduled_posts
      SET post_id = ?, status = 'GENERATED'
      WHERE id = ?
    `, [post.id, schedule.id]);
  }
});
```

### 3. 發文後更新學習數據

```typescript
// 在 Insights 同步後觸發
export async function onInsightsSynced(postId: string): Promise<void> {
  const pool = getPool();

  // 查詢排程資訊
  const [schedules] = await pool.execute<RowDataPacket[]>(`
    SELECT sp.*, pi.*
    FROM scheduled_posts sp
    JOIN post_insights pi ON sp.post_id = pi.post_id
    WHERE sp.post_id = ?
  `, [postId]);

  if (schedules.length === 0) return;

  const schedule = schedules[0];
  const insights = {
    views: schedule.views,
    likes: schedule.likes,
    replies: schedule.replies,
    reposts: schedule.reposts,
    shares: schedule.shares,
    engagementRate: schedule.engagement_rate
  };

  // 更新學習數據
  const scheduler = new SmartScheduler();
  await scheduler.updatePerformance(
    postId,
    schedule.time_slot_id,
    schedule.category_id,
    insights
  );

  logger.info(`Updated performance data for slot ${schedule.time_slot_id}, category ${schedule.category_id}`);
}
```

---

## 📊 監控與優化

### 儀表板查詢

```sql
-- 查看各時段-分類的表現排行
SELECT
  ts.name as time_slot,
  cc.name as category,
  scp.avg_engagement_rate,
  scp.total_posts,
  scp.confidence_score,
  CASE
    WHEN scp.total_posts < 5 THEN '數據不足'
    WHEN scp.avg_engagement_rate > 8 THEN '優秀'
    WHEN scp.avg_engagement_rate > 5 THEN '良好'
    ELSE '需改進'
  END as performance_level
FROM slot_category_performance scp
JOIN time_slots ts ON scp.time_slot_id = ts.id
JOIN content_categories cc ON scp.category_id = cc.id
ORDER BY scp.avg_engagement_rate DESC;

-- 查看探索vs利用比例
SELECT
  selection_reason,
  COUNT(*) as count,
  AVG(
    SELECT pi.engagement_rate
    FROM post_insights pi
    WHERE pi.post_id = sp.post_id
  ) as avg_engagement
FROM scheduled_posts sp
WHERE sp.status = 'POSTED'
  AND sp.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
GROUP BY selection_reason;
```

---

## 🎛️ 可調參數

```typescript
interface SchedulerConfig {
  explorationFactor: number;      // 1.5-2.5，越高越愛探索
  minPostsBeforeOptimize: number; // 最少嘗試次數才開始優化
  timeDecayHalfLife: number;      // 天數，近期表現權重
  successThreshold: number;       // 互動率多少算成功
  confidenceLevel: number;        // 0.90-0.99，信心區間
}

const config: SchedulerConfig = {
  explorationFactor: 1.8,
  minPostsBeforeOptimize: 10,
  timeDecayHalfLife: 30,
  successThreshold: 5.0,
  confidenceLevel: 0.95
};
```

---

## 🚀 實作步驟

1. **資料庫遷移** - 建立 4 個新表
2. **分類定義** - 設定內容分類和提示詞模板
3. **時段定義** - 設定可用的發文時段
4. **演算法實作** - SmartScheduler 類別
5. **排程整合** - 修改現有 cron scheduler
6. **監控介面** - 建立表現追蹤頁面
7. **A/B 測試** - 驗證效果

---

## 📈 預期效果

**初期（1-2 週）：**
- 大量探索，收集數據
- 平均互動率可能不穩定

**成長期（2-4 週）：**
- 開始識別最佳時段
- 互動率提升 20-30%

**成熟期（1-2 個月）：**
- 達到穩定的最佳化
- 互動率提升 40-60%
- 自動適應季節性變化

---

## ⚠️ 注意事項

1. **冷啟動問題** - 初期需要手動設定一些基準排程
2. **數據量要求** - 每個分類-時段至少需要 10 次嘗試
3. **外部因素** - 節日、熱門事件會影響表現
4. **過度優化** - 避免只用單一時段，保持多樣性

---

## 🔮 未來擴展

1. **深度學習模型** - 使用 LSTM 預測最佳時段
2. **多目標優化** - 同時優化互動率、觸及率、轉換率
3. **受眾分析** - 針對不同受眾群體優化
4. **競品分析** - 避開競爭對手的發文高峰
5. **情境感知** - 考慮天氣、新聞熱點等外部因素
