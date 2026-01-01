# 🎯 簡化版 AI 智能排程系統

## 需求定義

- **每天發文**: 1 篇
- **時段區間**: 例如 19:00 ~ 22:30（使用者自訂）
- **模板數量**: 2-3 個不同風格的提示詞
- **優化目標**: 找出最佳時段 + 最佳模板組合

---

## 📊 資料庫設計（最小化）

### 表 1: `content_templates`（內容模板）

```sql
CREATE TABLE content_templates (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  prompt TEXT NOT NULL,
  description TEXT,
  enabled BOOLEAN DEFAULT true,

  -- 統計數據
  total_uses INT DEFAULT 0,
  avg_engagement_rate DECIMAL(5,2) DEFAULT 0,

  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_enabled (enabled),
  INDEX idx_performance (avg_engagement_rate DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

**範例數據：**
```sql
INSERT INTO content_templates (id, name, prompt, description) VALUES
(
  'tmpl-001',
  '知識分享型',
  '分享一個關於{topic}的實用小知識，用簡單易懂的方式說明，讓讀者學到有用的東西',
  '適合教育性內容，強調實用價值'
),
(
  'tmpl-002',
  '輕鬆娛樂型',
  '寫一個關於{topic}的有趣小故事或幽默段子，讓讀者會心一笑',
  '適合娛樂性內容，強調趣味性'
),
(
  'tmpl-003',
  '情感共鳴型',
  '寫一段關於{topic}的溫暖文字，引發讀者情感共鳴，讓人感到溫暖或被理解',
  '適合情感性內容，強調共鳴感'
);
```

---

### 表 2: `posting_schedule_config`（排程配置）

```sql
CREATE TABLE posting_schedule_config (
  id VARCHAR(36) PRIMARY KEY,

  -- 時段設定
  start_hour INT NOT NULL,       -- 19 (表示 19:00)
  start_minute INT NOT NULL,     -- 0
  end_hour INT NOT NULL,         -- 22 (表示 22:00)
  end_minute INT NOT NULL,       -- 30

  -- 發文頻率
  posts_per_day INT DEFAULT 1,

  -- 星期設定（JSON array）
  active_days JSON,              -- [1,2,3,4,5] 表示週一到週五

  -- AI 設定
  exploration_rate DECIMAL(3,2) DEFAULT 0.20,  -- 20% 探索新組合

  enabled BOOLEAN DEFAULT true,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

**範例數據：**
```sql
INSERT INTO posting_schedule_config (id, start_hour, start_minute, end_hour, end_minute, active_days) VALUES
(
  'config-001',
  19, 0,    -- 19:00 開始
  22, 30,   -- 22:30 結束
  '[1,2,3,4,5,6,0]'  -- 每天都發
);
```

---

### 表 3: `post_performance_log`（發文表現記錄）

```sql
CREATE TABLE post_performance_log (
  id VARCHAR(36) PRIMARY KEY,
  post_id VARCHAR(36) NOT NULL,
  template_id VARCHAR(36) NOT NULL,

  -- 發文時間
  posted_at DATETIME NOT NULL,
  posted_hour INT NOT NULL,       -- 提取的小時
  posted_minute INT NOT NULL,     -- 提取的分鐘
  day_of_week INT NOT NULL,       -- 0-6

  -- 表現數據（從 post_insights 複製）
  views INT DEFAULT 0,
  likes INT DEFAULT 0,
  replies INT DEFAULT 0,
  engagement_rate DECIMAL(5,2) DEFAULT 0,

  -- AI 決策記錄
  selection_method ENUM('EXPLORATION', 'EXPLOITATION', 'RANDOM') DEFAULT 'RANDOM',
  ucb_score DECIMAL(10,4),

  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (post_id) REFERENCES posts(id),
  FOREIGN KEY (template_id) REFERENCES content_templates(id),
  INDEX idx_template_time (template_id, posted_hour),
  INDEX idx_performance (engagement_rate DESC),
  INDEX idx_posted_at (posted_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

---

## 🤖 核心算法：時段 + 模板 UCB

### 策略：30 分鐘為單位

將 19:00~22:30 分成多個時段：
- 19:00-19:30
- 19:30-20:00
- 20:00-20:30
- 20:30-21:00
- 21:00-21:30
- 21:30-22:00
- 22:00-22:30

每個時段 × 每個模板 = 組合選項

### TypeScript 實作

```typescript
interface TimeSlot {
  hour: number;
  minute: number;
  label: string;
}

interface TemplatePerformance {
  templateId: string;
  templateName: string;
  timeSlot: TimeSlot;
  avgEngagement: number;
  postCount: number;
  ucbScore: number;
}

class SmartDailyScheduler {
  private explorationRate = 0.20; // 20% 探索

  /**
   * 生成時段區間（30分鐘一個）
   */
  private generateTimeSlots(
    startHour: number,
    startMinute: number,
    endHour: number,
    endMinute: number
  ): TimeSlot[] {
    const slots: TimeSlot[] = [];
    let currentHour = startHour;
    let currentMinute = startMinute;

    const endTimeInMinutes = endHour * 60 + endMinute;

    while (true) {
      const currentTimeInMinutes = currentHour * 60 + currentMinute;
      if (currentTimeInMinutes >= endTimeInMinutes) break;

      slots.push({
        hour: currentHour,
        minute: currentMinute,
        label: `${String(currentHour).padStart(2, '0')}:${String(currentMinute).padStart(2, '0')}`
      });

      // 加 30 分鐘
      currentMinute += 30;
      if (currentMinute >= 60) {
        currentMinute -= 60;
        currentHour += 1;
      }
    }

    return slots;
  }

  /**
   * 選擇最佳時段 + 模板組合
   */
  async selectBestCombination(): Promise<{
    templateId: string;
    timeSlot: TimeSlot;
    reason: 'EXPLORATION' | 'EXPLOITATION';
    score: number;
  }> {
    const pool = getPool();

    // 1. 獲取配置
    const [configs] = await pool.execute<RowDataPacket[]>(`
      SELECT * FROM posting_schedule_config WHERE enabled = true LIMIT 1
    `);

    if (configs.length === 0) {
      throw new Error('No active schedule configuration');
    }

    const config = configs[0];
    const timeSlots = this.generateTimeSlots(
      config.start_hour,
      config.start_minute,
      config.end_hour,
      config.end_minute
    );

    // 2. 獲取啟用的模板
    const [templates] = await pool.execute<RowDataPacket[]>(`
      SELECT id, name FROM content_templates WHERE enabled = true
    `);

    if (templates.length === 0) {
      throw new Error('No active templates');
    }

    // 3. 決定探索 vs 利用
    const shouldExplore = Math.random() < this.explorationRate;

    if (shouldExplore) {
      // 隨機選擇（探索）
      const randomTemplate = templates[Math.floor(Math.random() * templates.length)];
      const randomSlot = timeSlots[Math.floor(Math.random() * timeSlots.length)];

      return {
        templateId: randomTemplate.id,
        timeSlot: randomSlot,
        reason: 'EXPLORATION',
        score: 0
      };
    }

    // 4. 計算每個組合的 UCB 分數
    const performances = await this.calculateAllCombinations(templates, timeSlots);

    // 找出最高分的組合
    const best = performances.reduce((max, curr) =>
      curr.ucbScore > max.ucbScore ? curr : max
    );

    return {
      templateId: best.templateId,
      timeSlot: best.timeSlot,
      reason: 'EXPLOITATION',
      score: best.ucbScore
    };
  }

  /**
   * 計算所有組合的 UCB 分數
   */
  private async calculateAllCombinations(
    templates: any[],
    timeSlots: TimeSlot[]
  ): Promise<TemplatePerformance[]> {
    const pool = getPool();
    const performances: TemplatePerformance[] = [];

    // 獲取總嘗試次數
    const [totalResult] = await pool.execute<RowDataPacket[]>(`
      SELECT COUNT(*) as total FROM post_performance_log
    `);
    const totalAttempts = totalResult[0].total;

    // 如果總數太少，返回隨機分數
    if (totalAttempts < 5) {
      for (const template of templates) {
        for (const slot of timeSlots) {
          performances.push({
            templateId: template.id,
            templateName: template.name,
            timeSlot: slot,
            avgEngagement: 0,
            postCount: 0,
            ucbScore: Math.random() * 10
          });
        }
      }
      return performances;
    }

    // 計算每個組合的表現
    for (const template of templates) {
      for (const slot of timeSlots) {
        // 查詢此組合的歷史表現
        // 時段匹配：前後 30 分鐘內都算
        const [results] = await pool.execute<RowDataPacket[]>(`
          SELECT
            COUNT(*) as post_count,
            AVG(engagement_rate) as avg_engagement
          FROM post_performance_log
          WHERE template_id = ?
            AND (
              (posted_hour = ? AND posted_minute >= ? - 30 AND posted_minute <= ? + 30)
              OR (posted_hour = ? - 1 AND posted_minute >= 30)
              OR (posted_hour = ? + 1 AND posted_minute <= 30)
            )
        `, [template.id, slot.hour, slot.minute, slot.minute, slot.hour, slot.hour]);

        const postCount = results[0].post_count || 0;
        const avgEngagement = results[0].avg_engagement || 0;

        // UCB 分數計算
        const explorationBonus = postCount > 0
          ? Math.sqrt((2 * Math.log(totalAttempts)) / postCount)
          : 10; // 未嘗試的給高分

        const ucbScore = avgEngagement + explorationBonus * 2;

        performances.push({
          templateId: template.id,
          templateName: template.name,
          timeSlot: slot,
          avgEngagement,
          postCount,
          ucbScore
        });
      }
    }

    return performances;
  }

  /**
   * 記錄發文表現
   */
  async logPerformance(
    postId: string,
    templateId: string,
    postedAt: Date,
    selectionMethod: 'EXPLORATION' | 'EXPLOITATION',
    ucbScore: number
  ): Promise<void> {
    const pool = getPool();

    await pool.execute(`
      INSERT INTO post_performance_log (
        id, post_id, template_id,
        posted_at, posted_hour, posted_minute, day_of_week,
        selection_method, ucb_score
      ) VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      postId,
      templateId,
      postedAt,
      postedAt.getHours(),
      postedAt.getMinutes(),
      postedAt.getDay(),
      selectionMethod,
      ucbScore
    ]);
  }

  /**
   * 更新表現數據（Insights 同步後呼叫）
   */
  async updatePerformanceData(postId: string): Promise<void> {
    const pool = getPool();

    // 從 post_insights 更新到 post_performance_log
    await pool.execute(`
      UPDATE post_performance_log ppl
      JOIN post_insights pi ON ppl.post_id = pi.post_id
      SET
        ppl.views = pi.views,
        ppl.likes = pi.likes,
        ppl.replies = pi.replies,
        ppl.engagement_rate = pi.engagement_rate
      WHERE ppl.post_id = ?
    `, [postId]);

    // 更新模板的平均表現
    const [logs] = await pool.execute<RowDataPacket[]>(`
      SELECT template_id FROM post_performance_log WHERE post_id = ?
    `, [postId]);

    if (logs.length > 0) {
      const templateId = logs[0].template_id;

      await pool.execute(`
        UPDATE content_templates
        SET
          total_uses = (SELECT COUNT(*) FROM post_performance_log WHERE template_id = ?),
          avg_engagement_rate = (SELECT AVG(engagement_rate) FROM post_performance_log WHERE template_id = ?)
        WHERE id = ?
      `, [templateId, templateId, templateId]);
    }
  }
}
```

---

## 🔄 完整工作流程

### 1. 每日排程（早上 00:00 執行）

```typescript
export const dailyScheduleGenerator = cron.schedule('0 0 * * *', async () => {
  logger.info('Generating daily posting schedule...');

  const scheduler = new SmartDailyScheduler();
  const pool = getPool();

  // 檢查今天是否要發文
  const [configs] = await pool.execute<RowDataPacket[]>(`
    SELECT * FROM posting_schedule_config WHERE enabled = true LIMIT 1
  `);

  if (configs.length === 0) return;

  const config = configs[0];
  const today = new Date().getDay();
  const activeDays = JSON.parse(config.active_days);

  if (!activeDays.includes(today)) {
    logger.info('Today is not an active posting day');
    return;
  }

  // AI 選擇最佳組合
  const selection = await scheduler.selectBestCombination();

  // 計算今天的發文時間
  const scheduledTime = new Date();
  scheduledTime.setHours(selection.timeSlot.hour, selection.timeSlot.minute, 0, 0);

  logger.info(`Scheduled post for ${scheduledTime.toISOString()}`);
  logger.info(`Template: ${selection.templateId}`);
  logger.info(`Reason: ${selection.reason}`);
  logger.info(`UCB Score: ${selection.score}`);

  // 儲存排程（使用現有的 scheduled_posts 或新表）
  await pool.execute(`
    INSERT INTO daily_scheduled_posts (
      id, template_id, scheduled_time, selection_method, ucb_score
    ) VALUES (UUID(), ?, ?, ?, ?)
  `, [selection.templateId, scheduledTime, selection.reason, selection.score]);
});
```

### 2. 定時檢查執行（每 5 分鐘）

```typescript
export const scheduledPostExecutor = cron.schedule('*/5 * * * *', async () => {
  const pool = getPool();
  const now = new Date();

  // 查詢需要執行的排程
  const [pending] = await pool.execute<RowDataPacket[]>(`
    SELECT dsp.*, ct.prompt
    FROM daily_scheduled_posts dsp
    JOIN content_templates ct ON dsp.template_id = ct.id
    WHERE dsp.status = 'PENDING'
      AND dsp.scheduled_time <= ?
      AND dsp.scheduled_time >= DATE_SUB(?, INTERVAL 10 MINUTE)
  `, [now, now]);

  for (const schedule of pending) {
    // 生成貼文
    const post = await PostModel.create({
      created_by: systemUserId,
      status: PostStatus.DRAFT
    });

    // 加入生成隊列
    await queueService.addGenerateJob({
      postId: post.id,
      stylePreset: schedule.prompt,
      engine: 'openai'
    });

    // 記錄表現日誌
    const scheduler = new SmartDailyScheduler();
    await scheduler.logPerformance(
      post.id,
      schedule.template_id,
      schedule.scheduled_time,
      schedule.selection_method,
      schedule.ucb_score
    );

    // 更新狀態
    await pool.execute(`
      UPDATE daily_scheduled_posts
      SET status = 'GENERATED', post_id = ?
      WHERE id = ?
    `, [post.id, schedule.id]);

    logger.info(`Generated post ${post.id} from schedule ${schedule.id}`);
  }
});
```

### 3. Insights 同步後更新

```typescript
// 在 src/services/threads-insights.service.ts 的 syncPostInsights 方法結尾加入
async syncPostInsights(postId: string): Promise<boolean> {
  // ... 現有代碼 ...

  // 新增：更新 AI 學習數據
  try {
    const scheduler = new SmartDailyScheduler();
    await scheduler.updatePerformanceData(postId);
    logger.info(`Updated AI learning data for post ${postId}`);
  } catch (error) {
    logger.error('Failed to update AI learning data:', error);
  }

  return true;
}
```

---

## 📊 分析與監控

### 查看學習進度

```sql
-- 各模板表現
SELECT
  ct.name,
  ct.total_uses,
  ct.avg_engagement_rate,
  CASE
    WHEN ct.avg_engagement_rate > 8 THEN '優秀 ⭐⭐⭐⭐⭐'
    WHEN ct.avg_engagement_rate > 6 THEN '良好 ⭐⭐⭐⭐'
    WHEN ct.avg_engagement_rate > 4 THEN '中等 ⭐⭐⭐'
    ELSE '需改進 ⭐⭐'
  END as level
FROM content_templates ct
WHERE ct.enabled = true
ORDER BY ct.avg_engagement_rate DESC;

-- 各時段表現
SELECT
  CONCAT(posted_hour, ':', LPAD(posted_minute, 2, '0')) as time_slot,
  COUNT(*) as post_count,
  AVG(engagement_rate) as avg_engagement,
  MAX(engagement_rate) as best_engagement
FROM post_performance_log
GROUP BY posted_hour, posted_minute
ORDER BY avg_engagement DESC;

-- 最佳組合
SELECT
  ct.name as template,
  CONCAT(ppl.posted_hour, ':', LPAD(ppl.posted_minute, 2, '0')) as best_time,
  AVG(ppl.engagement_rate) as avg_engagement,
  COUNT(*) as times_used
FROM post_performance_log ppl
JOIN content_templates ct ON ppl.template_id = ct.id
GROUP BY ct.name, ppl.posted_hour, ppl.posted_minute
HAVING times_used >= 3
ORDER BY avg_engagement DESC
LIMIT 10;
```

---

## 🎯 使用流程

### 初始設定

1. **設定模板**
   ```sql
   INSERT INTO content_templates (id, name, prompt) VALUES (...);
   ```

2. **設定時段**
   ```sql
   INSERT INTO posting_schedule_config (id, start_hour, start_minute, end_hour, end_minute)
   VALUES ('cfg-1', 19, 0, 22, 30);
   ```

3. **啟動系統**
   - 每天 00:00 自動規劃
   - 到時間自動發文
   - 收集數據學習

### 調整參數

```sql
-- 調整探索率（預設 20%）
UPDATE posting_schedule_config SET exploration_rate = 0.15 WHERE id = 'cfg-1';

-- 改變時段
UPDATE posting_schedule_config
SET start_hour = 18, end_hour = 23
WHERE id = 'cfg-1';
```

---

## 📈 預期效果

**第 1 週（探索期）：**
- 隨機嘗試各種組合
- 收集基礎數據

**第 2-4 週（學習期）：**
- 開始識別最佳組合
- 互動率逐漸提升 15-25%

**第 2 個月（優化期）：**
- 穩定在最佳時段和模板
- 互動率提升 30-50%

**長期（自適應）：**
- 持續追蹤受眾變化
- 自動調整策略
