import mysql from 'mysql2/promise';
import config from '../config';

const migrations = [
  // Migration 1: Users and Roles
  `
  CREATE TABLE IF NOT EXISTS users (
    id CHAR(36) PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL DEFAULT '',
    name VARCHAR(100) NOT NULL,
    line_user_id VARCHAR(64) UNIQUE NULL,
    status ENUM('ACTIVE', 'DISABLED') DEFAULT 'ACTIVE',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_email (email),
    INDEX idx_line_user_id (line_user_id),
    INDEX idx_status (status)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
  `,
  `
  CREATE TABLE IF NOT EXISTS roles (
    id CHAR(36) PRIMARY KEY,
    name VARCHAR(32) NOT NULL UNIQUE,
    INDEX idx_name (name)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
  `,
  `
  CREATE TABLE IF NOT EXISTS user_roles (
    user_id CHAR(36) NOT NULL,
    role_id CHAR(36) NOT NULL,
    PRIMARY KEY (user_id, role_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
  `,

  // Migration 2: Posts
  `
  CREATE TABLE IF NOT EXISTS posts (
    id CHAR(36) PRIMARY KEY,
    status ENUM(
      'DRAFT', 'GENERATING', 'PENDING_REVIEW', 'APPROVED',
      'PUBLISHING', 'POSTED', 'FAILED', 'ACTION_REQUIRED', 'SKIPPED'
    ) NOT NULL DEFAULT 'DRAFT',
    created_by CHAR(36) NOT NULL,
    approved_by CHAR(36) NULL,
    approved_at DATETIME NULL,
    posted_at DATETIME NULL,
    post_url VARCHAR(2048) NULL,
    last_error_code VARCHAR(64) NULL,
    last_error_message TEXT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by) REFERENCES users(id),
    FOREIGN KEY (approved_by) REFERENCES users(id),
    INDEX idx_status (status),
    INDEX idx_posted_at (posted_at),
    INDEX idx_created_at (created_at),
    INDEX idx_created_by (created_by)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
  `,

  // Migration 3: Post Revisions
  `
  CREATE TABLE IF NOT EXISTS post_revisions (
    id CHAR(36) PRIMARY KEY,
    post_id CHAR(36) NOT NULL,
    revision_no INT NOT NULL,
    title VARCHAR(255) NULL,
    content MEDIUMTEXT NOT NULL,
    engine_used VARCHAR(50) NOT NULL,
    similarity_max DECIMAL(5,4) NOT NULL DEFAULT 0,
    similarity_hits JSON NULL,
    generation_params JSON NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY unique_post_revision (post_id, revision_no),
    FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
    INDEX idx_post_id (post_id),
    INDEX idx_created_at (created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
  `,

  // Migration 4: Review Requests
  `
  CREATE TABLE IF NOT EXISTS review_requests (
    id CHAR(36) PRIMARY KEY,
    post_id CHAR(36) NOT NULL,
    revision_id CHAR(36) NOT NULL,
    token VARCHAR(128) NOT NULL UNIQUE,
    reviewer_user_id CHAR(36) NOT NULL,
    status ENUM('PENDING', 'USED', 'EXPIRED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    expires_at DATETIME NOT NULL,
    used_at DATETIME NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
    FOREIGN KEY (revision_id) REFERENCES post_revisions(id) ON DELETE CASCADE,
    FOREIGN KEY (reviewer_user_id) REFERENCES users(id),
    INDEX idx_token (token),
    INDEX idx_status (status),
    INDEX idx_expires_at (expires_at),
    INDEX idx_reviewer (reviewer_user_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
  `,

  // Migration 5: Threads Accounts
  `
  CREATE TABLE IF NOT EXISTS threads_accounts (
    id CHAR(36) PRIMARY KEY,
    user_id CHAR(36) NOT NULL,
    username VARCHAR(100) NOT NULL,
    account_id VARCHAR(100) NOT NULL,
    status ENUM('ACTIVE', 'LOCKED') NOT NULL DEFAULT 'ACTIVE',
    is_default TINYINT(1) DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_username (username),
    INDEX idx_user_id (user_id),
    INDEX idx_account_id (account_id),
    INDEX idx_is_default (is_default)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
  `,

  // Migration 6: Threads Auth
  `
  CREATE TABLE IF NOT EXISTS threads_auth (
    id CHAR(36) PRIMARY KEY,
    account_id CHAR(36) NOT NULL,
    access_token TEXT NOT NULL,
    token_type VARCHAR(20) DEFAULT 'Bearer',
    expires_at DATETIME NOT NULL,
    last_refreshed_at DATETIME NULL,
    status ENUM('OK', 'EXPIRED', 'ACTION_REQUIRED') NOT NULL DEFAULT 'OK',
    scopes JSON NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (account_id) REFERENCES threads_accounts(id) ON DELETE CASCADE,
    INDEX idx_account_id (account_id),
    INDEX idx_expires_at (expires_at),
    INDEX idx_status (status)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
  `,

  // Migration 7: Post Embeddings
  `
  CREATE TABLE IF NOT EXISTS post_embeddings (
    post_id CHAR(36) PRIMARY KEY,
    embedding_json JSON NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
  `,

  // Migration 8: Jobs
  `
  CREATE TABLE IF NOT EXISTS jobs (
    id CHAR(36) PRIMARY KEY,
    type ENUM('GENERATE', 'PUBLISH', 'TOKEN_REFRESH') NOT NULL,
    post_id CHAR(36) NULL,
    revision_id CHAR(36) NULL,
    account_id CHAR(36) NULL,
    status ENUM('QUEUED', 'RUNNING', 'SUCCESS', 'FAILED') NOT NULL DEFAULT 'QUEUED',
    attempts INT DEFAULT 0,
    result_json JSON NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE SET NULL,
    FOREIGN KEY (revision_id) REFERENCES post_revisions(id) ON DELETE SET NULL,
    FOREIGN KEY (account_id) REFERENCES threads_accounts(id) ON DELETE SET NULL,
    INDEX idx_type (type),
    INDEX idx_status (status),
    INDEX idx_created_at (created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
  `,

  // Migration 9: Audit Logs
  `
  CREATE TABLE IF NOT EXISTS audit_logs (
    id CHAR(36) PRIMARY KEY,
    actor_user_id CHAR(36) NULL,
    action VARCHAR(64) NOT NULL,
    target_type VARCHAR(32) NOT NULL,
    target_id CHAR(36) NOT NULL,
    metadata JSON NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_action (action),
    INDEX idx_target (target_type, target_id),
    INDEX idx_created_at (created_at),
    INDEX idx_actor (actor_user_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
  `,

  // Migration 10: Update engine_used column to support more engines
  `
  ALTER TABLE post_revisions
  MODIFY COLUMN engine_used VARCHAR(50) NOT NULL;
  `,

  // Migration 11: Add reviewed_at to review_requests (ignore error if exists)
  `
  ALTER TABLE review_requests
  ADD COLUMN reviewed_at DATETIME NULL AFTER used_at;
  `,

  // Migration 12: Add approved status to review_requests
  `
  ALTER TABLE review_requests
  MODIFY COLUMN status ENUM('PENDING', 'APPROVED', 'USED', 'EXPIRED', 'CANCELLED') NOT NULL DEFAULT 'PENDING';
  `,

  // Migration 13: Create post_insights table for tracking post metrics
  `
  CREATE TABLE IF NOT EXISTS post_insights (
    id CHAR(36) PRIMARY KEY,
    post_id CHAR(36) NOT NULL,

    views INT UNSIGNED DEFAULT 0,
    likes INT UNSIGNED DEFAULT 0,
    replies INT UNSIGNED DEFAULT 0,
    reposts INT UNSIGNED DEFAULT 0,
    quotes INT UNSIGNED DEFAULT 0,
    shares INT UNSIGNED DEFAULT 0,

    engagement_rate DECIMAL(5,2) DEFAULT 0,

    fetched_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
    INDEX idx_post_id (post_id),
    INDEX idx_fetched_at (fetched_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
  `,

  // Migration 14: Create account_insights table for tracking account metrics
  `
  CREATE TABLE IF NOT EXISTS account_insights (
    id CHAR(36) PRIMARY KEY,
    account_id CHAR(36) NOT NULL,

    followers_count INT UNSIGNED DEFAULT 0,
    following_count INT UNSIGNED DEFAULT 0,
    posts_count INT UNSIGNED DEFAULT 0,

    period_views INT UNSIGNED DEFAULT 0,
    period_interactions INT UNSIGNED DEFAULT 0,
    period_new_followers INT UNSIGNED DEFAULT 0,
    period_posts INT UNSIGNED DEFAULT 0,

    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    period_type ENUM('daily', 'weekly', 'monthly') DEFAULT 'weekly',

    fetched_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (account_id) REFERENCES threads_accounts(id) ON DELETE CASCADE,
    INDEX idx_account_id (account_id),
    INDEX idx_period (period_start, period_end),
    INDEX idx_fetched_at (fetched_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
  `,

  // Migration 15: Add threads_media_id to posts table
  `
  ALTER TABLE posts
  ADD COLUMN threads_media_id VARCHAR(64) NULL AFTER post_url,
  ADD INDEX idx_threads_media_id (threads_media_id);
  `,

  // Migration 16: Create content_templates table
  // 用途：儲存使用者定義的內容模板（提示詞）
  // 影響：新增獨立表，不影響現有功能
  `
  CREATE TABLE IF NOT EXISTS content_templates (
    id CHAR(36) PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE COMMENT '模板名稱，例如：知識分享型',
    prompt TEXT NOT NULL COMMENT 'AI 生成提示詞',
    description TEXT COMMENT '模板描述',
    enabled BOOLEAN DEFAULT true COMMENT '是否啟用',

    -- UCB 統計數據（初始為 0，隨使用次數累積）
    total_uses INT UNSIGNED DEFAULT 0 COMMENT '總使用次數',
    total_views INT UNSIGNED DEFAULT 0 COMMENT '總瀏覽數',
    total_engagement INT UNSIGNED DEFAULT 0 COMMENT '總互動數（讚+回覆+轉發）',
    avg_engagement_rate DECIMAL(5,2) DEFAULT 0.00 COMMENT '平均互動率（%）',

    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_enabled (enabled),
    INDEX idx_performance (avg_engagement_rate DESC)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    COMMENT='內容模板表：儲存不同風格的提示詞模板';
  `,

  // Migration 17: Create posting_schedule_config table
  // 用途：儲存發文時段配置
  // 影響：新增獨立表，不影響現有排程系統（scheduler.ts）
  `
  CREATE TABLE IF NOT EXISTS posting_schedule_config (
    id CHAR(36) PRIMARY KEY,

    -- 時段設定（單位：小時和分鐘）
    start_hour TINYINT UNSIGNED NOT NULL COMMENT '開始小時 (0-23)',
    start_minute TINYINT UNSIGNED NOT NULL COMMENT '開始分鐘 (0-59)',
    end_hour TINYINT UNSIGNED NOT NULL COMMENT '結束小時 (0-23)',
    end_minute TINYINT UNSIGNED NOT NULL COMMENT '結束分鐘 (0-59)',

    -- 發文頻率
    posts_per_day TINYINT UNSIGNED DEFAULT 1 COMMENT '每天發文數量',

    -- 星期設定（JSON array，例如 [1,2,3,4,5] 表示週一到週五）
    -- 0=星期日, 1=星期一, ..., 6=星期六
    active_days JSON COMMENT '啟用的星期，JSON 格式',

    -- AI 學習參數（目前方案 A 不使用，保留供未來擴展）
    exploration_rate DECIMAL(3,2) DEFAULT 0.20 COMMENT '探索率（0.00-1.00），預設 0.20 = 20%',

    enabled BOOLEAN DEFAULT true COMMENT '是否啟用此配置',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    -- 確保時段邏輯正確
    CONSTRAINT chk_time_range CHECK (
      (start_hour < end_hour) OR
      (start_hour = end_hour AND start_minute < end_minute)
    )
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    COMMENT='發文排程配置表：定義發文時段和頻率';
  `,

  // Migration 18: Create post_performance_log table
  // 用途：記錄每次發文的表現，用於分析最佳時段和模板組合
  // 影響：新增獨立表，不影響現有 posts 和 post_insights 表
  `
  CREATE TABLE IF NOT EXISTS post_performance_log (
    id CHAR(36) PRIMARY KEY,
    post_id CHAR(36) NOT NULL COMMENT '關聯的貼文 ID',
    template_id CHAR(36) NULL COMMENT '使用的模板 ID（NULL 表示手動輸入）',

    -- 發文時間資訊（冗餘設計，方便查詢和分析）
    posted_at DATETIME NOT NULL COMMENT '實際發文時間',
    posted_hour TINYINT UNSIGNED NOT NULL COMMENT '發文小時 (0-23)',
    posted_minute TINYINT UNSIGNED NOT NULL COMMENT '發文分鐘 (0-59)',
    day_of_week TINYINT UNSIGNED NOT NULL COMMENT '星期 (0=日, 1=一, ..., 6=六)',

    -- 表現數據（從 post_insights 複製，避免 JOIN 查詢）
    -- 初始為 0，等待 Insights 同步後更新
    views INT UNSIGNED DEFAULT 0 COMMENT '瀏覽數',
    likes INT UNSIGNED DEFAULT 0 COMMENT '按讚數',
    replies INT UNSIGNED DEFAULT 0 COMMENT '回覆數',
    engagement_rate DECIMAL(5,2) DEFAULT 0.00 COMMENT '互動率（%）',

    -- AI 決策記錄（方案 A 暫不使用，保留供未來擴展）
    selection_method ENUM('MANUAL', 'EXPLORATION', 'EXPLOITATION', 'RANDOM') DEFAULT 'MANUAL'
      COMMENT '選擇方式：MANUAL=人工, EXPLORATION=探索, EXPLOITATION=利用, RANDOM=隨機',
    ucb_score DECIMAL(10,4) NULL COMMENT 'UCB 分數（僅 AI 模式使用）',

    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
    FOREIGN KEY (template_id) REFERENCES content_templates(id) ON DELETE SET NULL,

    INDEX idx_template_time (template_id, posted_hour, posted_minute)
      COMMENT '用於查詢特定模板在特定時段的表現',
    INDEX idx_performance (engagement_rate DESC)
      COMMENT '用於排序查詢表現最好的組合',
    INDEX idx_posted_at (posted_at DESC)
      COMMENT '用於時間序列分析'
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    COMMENT='發文表現記錄表：追蹤每次發文的時段、模板和表現數據';
  `,

  // Migration 19: Create daily_scheduled_posts table (舊版，保留相容性)
  // 用途：儲存每日的發文排程（由使用者手動建立或未來由 AI 自動建立）
  // 影響：新增獨立表，不影響現有排程系統
  `
  CREATE TABLE IF NOT EXISTS daily_scheduled_posts (
    id CHAR(36) PRIMARY KEY,
    template_id CHAR(36) NOT NULL COMMENT '使用的模板 ID',
    scheduled_time DATETIME NOT NULL COMMENT '預定發文時間',

    post_id CHAR(36) NULL COMMENT '生成的貼文 ID（生成後填入）',

    status ENUM('PENDING', 'GENERATED', 'POSTED', 'FAILED', 'CANCELLED') DEFAULT 'PENDING'
      COMMENT '狀態：PENDING=待處理, GENERATED=已生成, POSTED=已發布, FAILED=失敗, CANCELLED=已取消',

    -- AI 決策記錄（方案 A 暫不使用）
    selection_method ENUM('MANUAL', 'EXPLORATION', 'EXPLOITATION') DEFAULT 'MANUAL'
      COMMENT '選擇方式：MANUAL=人工, EXPLORATION=探索, EXPLOITATION=利用',
    ucb_score DECIMAL(10,4) NULL COMMENT 'UCB 分數（僅 AI 模式使用）',

    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    FOREIGN KEY (template_id) REFERENCES content_templates(id) ON DELETE RESTRICT,
    FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE SET NULL,

    INDEX idx_scheduled_time (scheduled_time)
      COMMENT '用於查詢待執行的排程',
    INDEX idx_status (status)
      COMMENT '用於過濾不同狀態的排程',
    UNIQUE KEY uk_scheduled_time (scheduled_time)
      COMMENT '確保同一時間只有一個排程'
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    COMMENT='每日發文排程表：記錄每天的發文計畫';
  `,

  // Migration 20: Add UCB columns to content_templates (if not exist)
  // 用途：為現有的 content_templates 表新增 UCB 統計欄位
  // 影響：ALTER TABLE，如果欄位已存在會被跳過
  `
  ALTER TABLE content_templates
  ADD COLUMN total_views INT UNSIGNED DEFAULT 0 COMMENT '總瀏覽數' AFTER total_uses,
  ADD COLUMN total_engagement INT UNSIGNED DEFAULT 0 COMMENT '總互動數（讚+回覆+轉發）' AFTER total_views;
  `,

  // Migration 21: Create schedule_time_slots table
  // 用途：定義可發文的時段，及每個時段可用的模板池
  // 影響：新增獨立表，實現 UCB 智能排程的核心功能
  `
  CREATE TABLE IF NOT EXISTS schedule_time_slots (
    id CHAR(36) PRIMARY KEY,
    name VARCHAR(100) NOT NULL COMMENT '時段名稱，例如：晚間黃金時段',
    start_hour TINYINT UNSIGNED NOT NULL COMMENT '開始小時 (0-23)',
    start_minute TINYINT UNSIGNED NOT NULL COMMENT '開始分鐘 (0-59)',
    end_hour TINYINT UNSIGNED NOT NULL COMMENT '結束小時 (0-23)',
    end_minute TINYINT UNSIGNED NOT NULL COMMENT '結束分鐘 (0-59)',

    -- 該時段可用的模板 ID 列表 (JSON Array)
    allowed_template_ids JSON NOT NULL COMMENT '可用模板ID列表，例如：["id1","id2"]',

    -- 活躍日期設定 (JSON Array，1=週一...7=週日)
    active_days JSON NOT NULL COMMENT '活躍星期，例如：[1,2,3,4,5,6,7]',

    enabled BOOLEAN DEFAULT true COMMENT '是否啟用',
    priority INT DEFAULT 0 COMMENT '優先級（數字越大優先級越高）',

    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_enabled (enabled),
    INDEX idx_priority (priority DESC)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    COMMENT='時段配置表：定義發文時段和可用模板池';
  `,

  // Migration 22: Create smart_schedule_config table
  // 用途：全域配置，控制 UCB 演算法行為和排程設定
  // 影響：新增獨立表，儲存系統級配置
  `
  CREATE TABLE IF NOT EXISTS smart_schedule_config (
    id CHAR(36) PRIMARY KEY,

    -- UCB 參數
    exploration_factor DECIMAL(3,2) DEFAULT 1.50 COMMENT 'UCB 探索係數 (1.0-2.0)',
    min_trials_per_template INT DEFAULT 5 COMMENT '每個模板最少試驗次數',

    -- 排程設定
    posts_per_day TINYINT UNSIGNED DEFAULT 1 COMMENT '每天發文次數',
    auto_schedule_enabled BOOLEAN DEFAULT true COMMENT '是否啟用自動排程',

    -- 執行時間設定
    daily_schedule_time TIME DEFAULT '00:00:00' COMMENT '每日自動排程時間',

    enabled BOOLEAN DEFAULT true COMMENT '是否啟用',

    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    COMMENT='智能排程配置表：控制 UCB 演算法和自動排程行為';
  `,

  // Migration 23: Create daily_auto_schedule table
  // 用途：記錄系統自動建立的每日排程
  // 影響：新增獨立表，替代舊的 daily_scheduled_posts
  // 注意：暫不使用 foreign key，在應用層確保資料完整性
  `
  CREATE TABLE IF NOT EXISTS daily_auto_schedule (
    id CHAR(36) PRIMARY KEY,
    schedule_date DATE NOT NULL COMMENT '排程日期',

    -- AI 選擇結果
    selected_time_slot_id CHAR(36) COMMENT '選擇的時段',
    selected_template_id CHAR(36) COMMENT '選擇的模板',
    scheduled_time DATETIME NOT NULL COMMENT '預定發文時間',

    -- 執行狀態
    status ENUM('PENDING', 'GENERATED', 'POSTED', 'FAILED', 'CANCELLED') DEFAULT 'PENDING',
    post_id CHAR(36) COMMENT '生成的貼文 ID',

    -- UCB 決策數據
    ucb_score DECIMAL(10,4) COMMENT 'UCB 分數',
    selection_reason TEXT COMMENT '選擇原因',

    executed_at DATETIME COMMENT '實際執行時間',
    error_message TEXT COMMENT '錯誤訊息',

    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uk_schedule_date (schedule_date),
    INDEX idx_status (status),
    INDEX idx_scheduled_time (scheduled_time),
    INDEX idx_template (selected_template_id),
    INDEX idx_time_slot (selected_time_slot_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    COMMENT='每日自動排程表：記錄 AI 自動建立的每日發文計畫';
  `,

  // Migration 24: Add UCB columns to post_performance_log
  // 用途：為 post_performance_log 新增 UCB 相關欄位
  // 影響：ALTER TABLE，記錄 AI 決策過程
  `
  ALTER TABLE post_performance_log
  ADD COLUMN time_slot_id CHAR(36) COMMENT '使用的時段 ID' AFTER template_id,
  ADD COLUMN ucb_score DECIMAL(10,4) COMMENT 'UCB 分數' AFTER engagement_rate,
  ADD COLUMN was_exploration BOOLEAN DEFAULT false COMMENT '是否為探索性選擇' AFTER ucb_score,
  ADD COLUMN selection_reason TEXT COMMENT '選擇原因說明' AFTER was_exploration,
  ADD INDEX idx_time_slot (time_slot_id);
  `,

  // Migration 25: Add preferred_engine to content_templates
  // 用途：為模板新增偏好的 AI 引擎設定
  // 影響：ALTER TABLE，讓每個模板可以指定預設使用的 AI 引擎
  `
  ALTER TABLE content_templates
  ADD COLUMN preferred_engine VARCHAR(50) DEFAULT 'GPT5_2' COMMENT '偏好的AI引擎' AFTER description;
  `,

  // Migration 26: Add UCB scheduling settings to smart_schedule_config
  // 用途：為 UCB 智能排程新增 Threads 帳號、LINE 通知和時間範圍設定
  // 影響：ALTER TABLE，讓 UCB 排程支援帳號選擇、LINE 審核和時段配置
  `
  ALTER TABLE smart_schedule_config
  ADD COLUMN threads_account_id CHAR(36) COMMENT 'Threads 發布帳號 ID' AFTER auto_schedule_enabled,
  ADD COLUMN line_user_id VARCHAR(100) COMMENT 'LINE 通知接收者 User ID' AFTER threads_account_id,
  ADD COLUMN time_range_start TIME DEFAULT '09:00:00' COMMENT 'UCB 發文時段開始時間' AFTER line_user_id,
  ADD COLUMN time_range_end TIME DEFAULT '21:00:00' COMMENT 'UCB 發文時段結束時間' AFTER time_range_start,
  ADD COLUMN active_days JSON NULL COMMENT 'UCB 啟用星期，例如：[1,2,3,4,5,6,7] (1=週一, 7=週日)' AFTER time_range_end;
  `,

  // Migration 27: Add APPROVED status to daily_auto_schedule
  // 用途：為 daily_auto_schedule 的 status 新增 APPROVED 狀態
  // 影響：讓排程可以有「已核准，等待發布」的狀態
  // 注意：包含所有可能的狀態值以避免重新執行時資料截斷
  `
  ALTER TABLE daily_auto_schedule
  MODIFY COLUMN status ENUM('PENDING', 'GENERATED', 'APPROVED', 'PUBLISHING', 'POSTED', 'FAILED', 'CANCELLED', 'EXPIRED') DEFAULT 'PENDING';
  `,

  // Migration 28: Add template_id to posts table
  // 用途：為 posts 表新增 template_id 欄位，用於關聯模板進行統計分析
  // 注意：如果欄位已存在會報錯，但 migration 系統會跳過已執行的 migration
  `
  ALTER TABLE posts ADD COLUMN template_id CHAR(36) NULL;
  `,

  // Migration 29: Add ai_prompt and ai_engine to smart_schedule_config
  // 用途：簡化排程系統，改為單一提示詞模式（移除 UCB 多模板選擇）
  // 影響：儲存 AI 發文使用的提示詞和引擎設定
  `
  ALTER TABLE smart_schedule_config
  ADD COLUMN ai_prompt TEXT COMMENT 'AI 發文提示詞' AFTER active_days,
  ADD COLUMN ai_engine VARCHAR(50) DEFAULT 'GPT5_2' COMMENT 'AI 引擎' AFTER ai_prompt;
  `,

  // Migration 30: Add is_ai_generated to posts table
  // 用途：標記貼文是否為 AI 生成，用於統計分類
  // 分類：AI發、非AI(含圖)、非AI(無圖)
  `
  ALTER TABLE posts
  ADD COLUMN is_ai_generated BOOLEAN DEFAULT false COMMENT '是否為 AI 生成' AFTER template_id;
  `,

  // ========================================
  // Migration 31-37: 聲量監控系統
  // ========================================

  // Migration 31: 品牌管理表 monitor_brands
  `
  CREATE TABLE IF NOT EXISTS monitor_brands (
    id CHAR(36) PRIMARY KEY,
    
    -- 基本資訊
    name VARCHAR(100) NOT NULL COMMENT '品牌名稱',
    short_name VARCHAR(50) NULL COMMENT '簡稱/代碼',
    description TEXT NULL COMMENT '品牌描述',
    logo_url VARCHAR(500) NULL COMMENT 'Logo 圖片 URL',
    brand_type ENUM('own', 'competitor', 'industry', 'other') DEFAULT 'own' COMMENT '類型',
    category VARCHAR(100) NULL COMMENT '產業類別',
    
    -- 關鍵字設定
    keywords JSON NOT NULL COMMENT '監控關鍵字',
    keyword_groups JSON NULL COMMENT '關鍵字分組',
    exclude_keywords JSON NULL COMMENT '排除關鍵字',
    hashtags JSON NULL COMMENT '追蹤的 Hashtag',
    
    -- 通知設定
    notify_enabled BOOLEAN DEFAULT true COMMENT '啟用即時通知',
    notify_channels JSON DEFAULT ('["line"]') COMMENT '通知管道',
    notify_threshold INT DEFAULT 1 COMMENT '累積 N 筆才通知',
    notify_interval_minutes INT DEFAULT 30 COMMENT '通知間隔（分鐘）',
    notify_negative_only BOOLEAN DEFAULT false COMMENT '僅負面才通知',
    notify_high_engagement BOOLEAN DEFAULT true COMMENT '高互動時通知',
    engagement_threshold INT DEFAULT 100 COMMENT '高互動閾值',
    
    -- 報表設定
    report_enabled BOOLEAN DEFAULT false COMMENT '啟用自動報表',
    report_frequency ENUM('daily', 'weekly', 'monthly') DEFAULT 'weekly' COMMENT '報表頻率',
    report_recipients JSON NULL COMMENT '報表收件人 Email',
    
    -- 顯示設定
    display_color VARCHAR(7) DEFAULT '#667eea' COMMENT '顯示顏色',
    display_order INT DEFAULT 0 COMMENT '排序順序',
    is_pinned BOOLEAN DEFAULT false COMMENT '置頂顯示',
    
    -- 狀態
    is_active BOOLEAN DEFAULT true COMMENT '是否啟用',
    
    -- 時間戳記
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    created_by CHAR(36) NULL COMMENT '建立者',
    
    INDEX idx_active_type (is_active, brand_type),
    INDEX idx_order (display_order)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='品牌/監控目標管理';
  `,

  // Migration 32: 監控來源表 monitor_sources
  `
  CREATE TABLE IF NOT EXISTS monitor_sources (
    id CHAR(36) PRIMARY KEY,
    
    -- 基本資訊
    name VARCHAR(100) NOT NULL COMMENT '來源名稱',
    description TEXT NULL COMMENT '描述',
    url VARCHAR(2000) NOT NULL COMMENT '監控網址',
    platform ENUM('dcard', 'ptt', 'facebook', 'instagram', 'youtube', 'threads', 'twitter', 'news', 'blog', 'forum', 'pixnet', 'mobile01', 'other') DEFAULT 'other' COMMENT '平台類型',
    platform_category VARCHAR(50) NULL COMMENT '平台子分類',
    
    -- 來源類型
    source_type ENUM('page', 'search', 'rss', 'api') DEFAULT 'page' COMMENT '來源類型',
    search_query VARCHAR(200) NULL COMMENT '搜尋關鍵字（當 source_type=search）',
    
    -- 抓取設定
    check_interval_hours INT DEFAULT 1 COMMENT '檢查間隔（小時，1-24）',
    crawl_depth INT DEFAULT 1 COMMENT '爬取深度',
    max_pages INT DEFAULT 3 COMMENT '最多爬幾頁',
    max_items_per_check INT DEFAULT 50 COMMENT '每次最多處理幾筆',
    
    -- 技術設定
    use_puppeteer BOOLEAN DEFAULT false COMMENT '使用無頭瀏覽器',
    user_agent VARCHAR(500) NULL COMMENT '自訂 User-Agent',
    request_delay_ms INT DEFAULT 1000 COMMENT '請求間隔（毫秒）',
    timeout_seconds INT DEFAULT 30 COMMENT '超時秒數',
    
    -- 選取器設定
    selectors JSON NULL COMMENT 'CSS 選取器設定',
    
    -- 健康狀態
    is_active BOOLEAN DEFAULT true COMMENT '是否啟用',
    health_status ENUM('healthy', 'warning', 'error', 'unknown') DEFAULT 'unknown' COMMENT '健康狀態',
    last_checked_at DATETIME NULL COMMENT '上次檢查時間',
    last_success_at DATETIME NULL COMMENT '上次成功時間',
    consecutive_failures INT DEFAULT 0 COMMENT '連續失敗次數',
    last_error TEXT NULL COMMENT '最後錯誤訊息',
    total_crawl_count INT DEFAULT 0 COMMENT '總爬取次數',
    total_mention_count INT DEFAULT 0 COMMENT '總發現提及數',
    
    -- 時間戳記
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    created_by CHAR(36) NULL,
    
    INDEX idx_active (is_active),
    INDEX idx_platform (platform),
    INDEX idx_next_check (is_active, last_checked_at),
    INDEX idx_health (health_status)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='監控來源網站設定';
  `,

  // Migration 33: 品牌-來源關聯表 monitor_brand_sources
  `
  CREATE TABLE IF NOT EXISTS monitor_brand_sources (
    id CHAR(36) PRIMARY KEY,
    brand_id CHAR(36) NOT NULL,
    source_id CHAR(36) NOT NULL,
    
    -- 個別設定
    custom_keywords JSON NULL COMMENT '此來源專用關鍵字',
    custom_notify_enabled BOOLEAN NULL COMMENT '覆蓋通知設定',
    priority INT DEFAULT 0 COMMENT '優先度',
    
    -- 時間戳記
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE KEY uk_brand_source (brand_id, source_id),
    FOREIGN KEY (brand_id) REFERENCES monitor_brands(id) ON DELETE CASCADE,
    FOREIGN KEY (source_id) REFERENCES monitor_sources(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='品牌與監控來源關聯';
  `,

  // Migration 34: 提及記錄表 monitor_mentions
  `
  CREATE TABLE IF NOT EXISTS monitor_mentions (
    id CHAR(36) PRIMARY KEY,
    
    -- 關聯
    source_id CHAR(36) NOT NULL COMMENT '來源',
    brand_id CHAR(36) NOT NULL COMMENT '品牌',
    crawl_log_id CHAR(36) NULL COMMENT '關聯爬取日誌',
    
    -- 文章基本資訊
    external_id VARCHAR(200) NULL COMMENT '外部平台文章 ID',
    url VARCHAR(2000) NOT NULL COMMENT '文章連結',
    title VARCHAR(1000) NULL COMMENT '標題',
    content MEDIUMTEXT NULL COMMENT '完整內容',
    content_preview VARCHAR(500) NULL COMMENT '內容摘要',
    content_length INT NULL COMMENT '內容字數',
    content_hash VARCHAR(64) NULL COMMENT '內容 Hash',
    
    -- 作者資訊
    author_id VARCHAR(100) NULL COMMENT '作者 ID',
    author_name VARCHAR(100) NULL COMMENT '作者名稱',
    author_avatar_url VARCHAR(500) NULL COMMENT '作者頭像',
    author_followers INT NULL COMMENT '作者粉絲數',
    is_kol BOOLEAN DEFAULT false COMMENT '是否為 KOL',
    
    -- 匹配資訊
    matched_keywords JSON NOT NULL COMMENT '觸發的關鍵字',
    keyword_count INT DEFAULT 1 COMMENT '關鍵字出現總次數',
    match_location ENUM('title', 'content', 'both', 'hashtag') DEFAULT 'content' COMMENT '匹配位置',
    match_context TEXT NULL COMMENT '關鍵字上下文',
    
    -- 互動數據
    likes_count INT NULL COMMENT '讚數',
    comments_count INT NULL COMMENT '留言數',
    shares_count INT NULL COMMENT '分享數',
    views_count INT NULL COMMENT '觀看數',
    engagement_score INT NULL COMMENT '互動分數',
    is_high_engagement BOOLEAN DEFAULT false COMMENT '高互動標記',
    
    -- 情感分析（預留）
    sentiment ENUM('positive', 'negative', 'neutral', 'mixed') NULL COMMENT '情感傾向',
    sentiment_score DECIMAL(4,3) NULL COMMENT '情感分數 -1.000 到 1.000',
    sentiment_confidence DECIMAL(3,2) NULL COMMENT '信心度 0-1',
    sentiment_keywords JSON NULL COMMENT '情感關鍵詞',
    sentiment_analyzed_at DATETIME NULL COMMENT '分析時間',
    
    -- 議題分類（預留）
    topics JSON NULL COMMENT '議題標籤',
    category VARCHAR(50) NULL COMMENT '自動分類',
    
    -- 時間資訊
    published_at DATETIME NULL COMMENT '原文發布時間',
    discovered_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '發現時間',
    
    -- 通知狀態
    is_notified BOOLEAN DEFAULT false COMMENT '已 LINE 通知',
    notified_at DATETIME NULL COMMENT '通知時間',
    notification_id CHAR(36) NULL COMMENT '關聯通知記錄',
    
    -- 使用者操作
    is_read BOOLEAN DEFAULT false COMMENT '已讀',
    read_at DATETIME NULL,
    is_starred BOOLEAN DEFAULT false COMMENT '星號標記',
    is_archived BOOLEAN DEFAULT false COMMENT '封存',
    is_flagged BOOLEAN DEFAULT false COMMENT '標記為問題',
    flag_reason VARCHAR(200) NULL COMMENT '標記原因',
    user_notes TEXT NULL COMMENT '使用者備註',
    assigned_to CHAR(36) NULL COMMENT '指派給',
    
    -- 處理狀態
    action_status ENUM('new', 'viewed', 'processing', 'responded', 'resolved', 'ignored') DEFAULT 'new' COMMENT '處理狀態',
    action_notes TEXT NULL COMMENT '處理備註',
    resolved_at DATETIME NULL,
    resolved_by CHAR(36) NULL,
    
    -- 時間戳記
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_brand_discovered (brand_id, discovered_at DESC),
    INDEX idx_source_discovered (source_id, discovered_at DESC),
    INDEX idx_unread (brand_id, is_read, discovered_at DESC),
    INDEX idx_unnotified (is_notified, discovered_at),
    INDEX idx_sentiment (sentiment, discovered_at),
    INDEX idx_engagement (is_high_engagement, engagement_score DESC),
    INDEX idx_action (action_status, discovered_at),
    INDEX idx_content_hash (content_hash),
    INDEX idx_external_id (external_id),
    INDEX idx_published (published_at DESC),
    
    FOREIGN KEY (brand_id) REFERENCES monitor_brands(id) ON DELETE CASCADE,
    FOREIGN KEY (source_id) REFERENCES monitor_sources(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='輿情提及記錄';
  `,

  // Migration 35: 統計彙總表 monitor_stats
  `
  CREATE TABLE IF NOT EXISTS monitor_stats (
    id CHAR(36) PRIMARY KEY,
    
    -- 維度
    brand_id CHAR(36) NOT NULL,
    source_id CHAR(36) NULL COMMENT 'NULL = 全來源合計',
    stat_date DATE NOT NULL COMMENT '統計日期',
    stat_type ENUM('daily', 'weekly', 'monthly') DEFAULT 'daily' COMMENT '統計類型',
    
    -- 聲量統計
    mention_count INT DEFAULT 0 COMMENT '提及次數',
    unique_articles INT DEFAULT 0 COMMENT '不重複文章數',
    unique_authors INT DEFAULT 0 COMMENT '不重複作者數',
    
    -- 情感統計
    positive_count INT DEFAULT 0,
    negative_count INT DEFAULT 0,
    neutral_count INT DEFAULT 0,
    mixed_count INT DEFAULT 0,
    avg_sentiment_score DECIMAL(4,3) NULL COMMENT '平均情感分數',
    
    -- 互動統計
    total_likes INT DEFAULT 0,
    total_comments INT DEFAULT 0,
    total_shares INT DEFAULT 0,
    total_views INT DEFAULT 0,
    total_engagement INT DEFAULT 0,
    avg_engagement DECIMAL(10,2) DEFAULT 0,
    max_engagement INT DEFAULT 0 COMMENT '單篇最高互動',
    high_engagement_count INT DEFAULT 0 COMMENT '高互動貼文數',
    
    -- KOL 統計
    kol_mention_count INT DEFAULT 0 COMMENT 'KOL 提及數',
    
    -- 時段分佈
    hourly_distribution JSON NULL COMMENT '24小時分佈',
    
    -- 比較數據
    mention_change_percent DECIMAL(5,2) NULL COMMENT '與前期比較變化%',
    engagement_change_percent DECIMAL(5,2) NULL,
    
    -- 熱門關鍵字
    top_keywords JSON NULL COMMENT '熱門關鍵字',
    top_topics JSON NULL COMMENT '熱門議題',
    
    -- 時間戳記
    calculated_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '計算時間',
    
    UNIQUE KEY uk_brand_source_date_type (brand_id, source_id, stat_date, stat_type),
    INDEX idx_brand_date (brand_id, stat_date DESC),
    INDEX idx_stat_type (stat_type, stat_date DESC),
    
    FOREIGN KEY (brand_id) REFERENCES monitor_brands(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='聲量統計彙總';
  `,

  // Migration 36: 爬取日誌表 monitor_crawl_logs
  `
  CREATE TABLE IF NOT EXISTS monitor_crawl_logs (
    id CHAR(36) PRIMARY KEY,
    source_id CHAR(36) NOT NULL,
    
    -- 執行資訊
    started_at DATETIME NOT NULL,
    completed_at DATETIME NULL,
    duration_ms INT NULL COMMENT '執行時間（毫秒）',
    
    -- 結果統計
    status ENUM('running', 'success', 'partial', 'failed', 'timeout', 'skipped') DEFAULT 'running',
    pages_crawled INT DEFAULT 0 COMMENT '爬取頁數',
    articles_found INT DEFAULT 0 COMMENT '發現文章數',
    articles_processed INT DEFAULT 0 COMMENT '處理文章數',
    new_mentions INT DEFAULT 0 COMMENT '新增提及數',
    duplicate_skipped INT DEFAULT 0 COMMENT '重複跳過數',
    
    -- 錯誤資訊
    error_code VARCHAR(50) NULL,
    error_message TEXT NULL,
    error_stack TEXT NULL,
    
    -- 時間戳記
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_source_date (source_id, started_at DESC),
    INDEX idx_status (status, started_at DESC),
    
    FOREIGN KEY (source_id) REFERENCES monitor_sources(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='爬取執行日誌';
  `,

  // Migration 37: 通知日誌表 monitor_notifications
  `
  CREATE TABLE IF NOT EXISTS monitor_notifications (
    id CHAR(36) PRIMARY KEY,
    
    -- 通知類型
    notification_type ENUM('realtime', 'digest', 'alert', 'report') DEFAULT 'realtime' COMMENT '類型',
    channel ENUM('line', 'email', 'webhook', 'sms') DEFAULT 'line',
    
    -- 關聯
    brand_id CHAR(36) NULL,
    mention_ids JSON NULL COMMENT '包含的提及 ID 列表',
    mention_count INT DEFAULT 0,
    
    -- 通知內容
    title VARCHAR(200) NULL,
    summary TEXT NULL COMMENT '摘要內容',
    message TEXT NULL COMMENT '完整通知內容',
    
    -- 狀態
    status ENUM('pending', 'sending', 'sent', 'failed', 'cancelled') DEFAULT 'pending',
    retry_count INT DEFAULT 0,
    max_retries INT DEFAULT 3,
    
    -- 結果
    sent_at DATETIME NULL,
    error_message TEXT NULL,
    response_data JSON NULL COMMENT 'API 回應',
    
    -- 時間戳記
    scheduled_at DATETIME NULL COMMENT '排程發送時間',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_status (status, created_at),
    INDEX idx_brand (brand_id, created_at DESC),
    INDEX idx_channel (channel, status)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='通知發送日誌';
  `,

  // Migration 38: Google Trends 趨勢表 monitor_trends
  `
  CREATE TABLE IF NOT EXISTS monitor_trends (
    id CHAR(36) PRIMARY KEY,
    
    -- 關聯
    brand_id CHAR(36) NOT NULL,
    
    -- 數據來源
    source ENUM('google_trends', 'other') DEFAULT 'google_trends',
    keyword VARCHAR(200) NOT NULL COMMENT '搜尋的關鍵字',
    
    -- 趨勢數據
    trend_date DATE NOT NULL,
    trend_value INT NULL COMMENT '熱度值 0-100',
    
    -- 地區
    region VARCHAR(50) DEFAULT 'TW',
    region_breakdown JSON NULL COMMENT '各地區分佈',
    
    -- 相關搜尋
    related_queries JSON NULL COMMENT '相關搜尋詞',
    rising_queries JSON NULL COMMENT '快速上升的搜尋詞',
    
    -- 時間戳記
    fetched_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE KEY uk_brand_keyword_date (brand_id, keyword, trend_date),
    INDEX idx_brand_date (brand_id, trend_date DESC),
    
    FOREIGN KEY (brand_id) REFERENCES monitor_brands(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Google Trends 搜尋趨勢';
  `,

  // Migration 39: Add topic_category to posts
  `ALTER TABLE posts ADD COLUMN topic_category VARCHAR(50) NULL COMMENT '主題分類'`,

  // Migration 39b: Add learning_metadata column
  `ALTER TABLE posts ADD COLUMN learning_metadata JSON NULL COMMENT 'AI學習相關元數據'`,

  // Migration 40: generation_plan column
  `ALTER TABLE posts ADD COLUMN generation_plan JSON NULL COMMENT '生成計劃'`,

  // Migration 40b: angle column
  `ALTER TABLE posts ADD COLUMN angle VARCHAR(100) NULL COMMENT '切角'`,

  // Migration 40c: outlet column
  `ALTER TABLE posts ADD COLUMN outlet VARCHAR(100) NULL COMMENT '出口/處理方式'`,

  // Migration 40d: tone_bias column
  `ALTER TABLE posts ADD COLUMN tone_bias VARCHAR(100) NULL COMMENT '語氣偏壓'`,

  // Migration 40e: ending_style column
  `ALTER TABLE posts ADD COLUMN ending_style VARCHAR(100) NULL COMMENT '收尾意圖'`,

  // Migration 40f: length_target column
  `ALTER TABLE posts ADD COLUMN length_target VARCHAR(20) NULL COMMENT '字數目標'`,

  // Migration 40g: risk_flags column
  `ALTER TABLE posts ADD COLUMN risk_flags JSON NULL COMMENT '風險標記'`,

  // Migration 40h: post_check_result column
  `ALTER TABLE posts ADD COLUMN post_check_result JSON NULL COMMENT '生成後檢測結果'`,

  // Migration 40i: retry_count column
  `ALTER TABLE posts ADD COLUMN retry_count INT DEFAULT 0 COMMENT '重試次數'`,

  // Migration 41: Generation Dimensions 設定表
  `
  CREATE TABLE IF NOT EXISTS generation_dimensions (
    id CHAR(36) PRIMARY KEY,
    dimension_type ENUM('module', 'angle', 'outlet', 'tone_bias', 'ending_style', 'length_target') NOT NULL,
    code VARCHAR(100) NOT NULL COMMENT '代碼',
    name VARCHAR(200) NOT NULL COMMENT '中文名稱',
    description TEXT NULL COMMENT '說明',
    weight DECIMAL(3,2) DEFAULT 1.00 COMMENT '權重 0.00-1.00',
    is_active BOOLEAN DEFAULT TRUE,
    display_order INT DEFAULT 0,
    
    -- 相容性規則
    compatible_modules JSON NULL COMMENT '可搭配的 MODULE 代碼陣列',
    incompatible_with JSON NULL COMMENT '不可搭配的其他維度代碼陣列',
    
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    UNIQUE KEY uk_type_code (dimension_type, code),
    INDEX idx_type_active (dimension_type, is_active)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='AI生成維度設定';
  `,

  // Migration 42: 插入預設維度資料 - MODULE
  `
  INSERT IGNORE INTO generation_dimensions (id, dimension_type, code, name, description, weight, display_order) VALUES
  (UUID(), 'module', 'pleasure_relief', '爽與解壓', '高潮舒壓、快感釋放、慾火起來、讓人覺得爽是合理的', 0.40, 1),
  (UUID(), 'module', 'practical', '務實處理', '不想等、不想配合、懶得前戲、想快一點、省事快戰速決', 0.30, 2),
  (UUID(), 'module', 'uncomfortable_truth', '不舒服真實', '爽完不想理人、真人vs玩具殘酷對比、自私但不道歉、被拒絕久了務實轉向', 0.20, 3),
  (UUID(), 'module', 'controversial', '爭議提問', '反問、拋殘酷事實、不給答案、引戰留言區爆', 0.10, 4);
  `,

  // Migration 43: 插入預設維度資料 - ANGLE (切角)
  `
  INSERT IGNORE INTO generation_dimensions (id, dimension_type, code, name, description, weight, display_order) VALUES
  (UUID(), 'angle', 'after_shower', '洗完澡', '洗完澡身體放鬆敏感', 0.08, 1),
  (UUID(), 'angle', 'lights_off', '關燈後', '關燈後獨處的慾望', 0.08, 2),
  (UUID(), 'angle', 'family_home', '家裡有人', '有人在家但還是想解決', 0.06, 3),
  (UUID(), 'angle', 'rejected_long', '被拒絕久了', '被拒絕一段時間後的務實轉向', 0.08, 4),
  (UUID(), 'angle', 'after_workout', '運動後', '運動後爆汗身體很敏感', 0.06, 5),
  (UUID(), 'angle', 'period_around', '生理期前後', '生理期前後慾望特別強', 0.06, 6),
  (UUID(), 'angle', 'late_night', '深夜獨處', '深夜安靜下來的慾望', 0.10, 7),
  (UUID(), 'angle', 'before_sleep', '睡前', '睡前想放鬆一下', 0.08, 8),
  (UUID(), 'angle', 'just_woke_up', '剛醒來', '早起時身體很敏感', 0.06, 9),
  (UUID(), 'angle', 'after_work', '下班後', '下班後累但想解壓', 0.08, 10),
  (UUID(), 'angle', 'watching_drama', '追劇到激情戲', '看到激情畫面被挑起', 0.06, 11),
  (UUID(), 'angle', 'weekend_morning', '週末早上', '難得的悠閒時光', 0.06, 12),
  (UUID(), 'angle', 'partner_asleep', '對方睡著了', '對方已經睡了自己還想要', 0.06, 13),
  (UUID(), 'angle', 'sudden_urge', '突然很想要', '沒有特別原因就是突然慾火起來', 0.08, 14);
  `,

  // Migration 44: 插入預設維度資料 - OUTLET (出口/處理方式)
  `
  INSERT IGNORE INTO generation_dimensions (id, dimension_type, code, name, description, weight, display_order, compatible_modules) VALUES
  (UUID(), 'outlet', 'solo_slow', '自慰-慢慢玩', '享受過程慢慢來', 0.12, 1, '["pleasure_relief"]'),
  (UUID(), 'outlet', 'solo_quick', '自慰-快戰速決', '直接追求高潮解決', 0.15, 2, '["practical", "pleasure_relief"]'),
  (UUID(), 'outlet', 'solo_edging', '自慰-停停走走', '快到就停再來', 0.08, 3, '["pleasure_relief"]'),
  (UUID(), 'outlet', 'toy_solo', '玩具-自己用', '用玩具更有效率', 0.15, 4, '["practical", "pleasure_relief"]'),
  (UUID(), 'outlet', 'toy_together', '玩具-兩人一起', '兩個人一起用減壓加速升級', 0.10, 5, '["pleasure_relief"]'),
  (UUID(), 'outlet', 'find_partner', '找人', '有對象且互動成立時', 0.10, 6, '["pleasure_relief"]'),
  (UUID(), 'outlet', 'hold_for_now', '先忍-改天換方式', '暫時忍住但有下一步', 0.08, 7, '["uncomfortable_truth"]'),
  (UUID(), 'outlet', 'lower_bar', '降低門檻', '不用鋪陳直接追快感', 0.12, 8, '["practical"]'),
  (UUID(), 'outlet', 'toy_vs_real', '玩具比真人穩', '玩具不會拒絕不會累', 0.10, 9, '["uncomfortable_truth"]');
  `,

  // Migration 45: 插入預設維度資料 - TONE_BIAS (語氣偏壓)
  `
  INSERT IGNORE INTO generation_dimensions (id, dimension_type, code, name, description, weight, display_order) VALUES
  (UUID(), 'tone_bias', 'blunt_raw', '直白粗暴', '直接講不包裝', 0.25, 1),
  (UUID(), 'tone_bias', 'playful_mean', '調皮嘴賤', '帶點調侃欠揍', 0.20, 2),
  (UUID(), 'tone_bias', 'cold_practical', '冷淡務實', '冷冷的講事實', 0.20, 3),
  (UUID(), 'tone_bias', 'annoying_honest', '欠揍誠實', '讓人想打但是真話', 0.20, 4),
  (UUID(), 'tone_bias', 'gentle_no_comfort', '溫和但不安慰', '語氣溫但不是療癒', 0.15, 5);
  `,

  // Migration 46: 插入預設維度資料 - ENDING_STYLE (收尾意圖)
  `
  INSERT IGNORE INTO generation_dimensions (id, dimension_type, code, name, description, weight, display_order) VALUES
  (UUID(), 'ending_style', 'done_sleep', '收工型', '做完就好可以睡了', 0.20, 1),
  (UUID(), 'ending_style', 'contrast', '反差型', '原本以為...結果...', 0.12, 2),
  (UUID(), 'ending_style', 'sage_mode', '聖人模式', '爽完世界靜音不想理人', 0.15, 3),
  (UUID(), 'ending_style', 'provocative', '挑釁型', '留刺點引戰', 0.10, 4),
  (UUID(), 'ending_style', 'blank_ending', '留白型', '停在動作不上價值', 0.15, 5),
  (UUID(), 'ending_style', 'upgrade_together', '升級型', '兩人一起用換玩法更快到', 0.08, 6),
  (UUID(), 'ending_style', 'relief_done', '解放完成', '壓力真的小很多', 0.10, 7),
  (UUID(), 'ending_style', 'no_wait', '不用等型', '至少不用再等', 0.10, 8);
  `,

  // Migration 47: 插入預設維度資料 - LENGTH_TARGET (字數目標)
  `
  INSERT IGNORE INTO generation_dimensions (id, dimension_type, code, name, description, weight, display_order) VALUES
  (UUID(), 'length_target', '50-70', '短狠', '50-70字 短而有力', 0.35, 1),
  (UUID(), 'length_target', '70-95', '中等', '70-95字 標準長度', 0.40, 2),
  (UUID(), 'length_target', '95-120', '慢慢戳', '95-120字 較長描述', 0.25, 3);
  `,

  // Migration 48: 修復 daily_auto_schedule status ENUM，添加 PUBLISHING 狀態
  // 影響：讓排程可以有「發布中」的過渡狀態
  // 注意：包含所有可能的狀態值以避免重新執行時資料截斷
  `
  ALTER TABLE daily_auto_schedule
  MODIFY COLUMN status ENUM('PENDING', 'GENERATED', 'APPROVED', 'PUBLISHING', 'POSTED', 'FAILED', 'CANCELLED', 'EXPIRED') DEFAULT 'PENDING';
  `,

  // Migration 49: 修復 2026-01-19 排程狀態（如果存在且狀態為 FAILED 但實際已發文）
  `
  UPDATE daily_auto_schedule SET status = 'POSTED' WHERE schedule_date = '2026-01-19' AND status = 'FAILED';
  `,

  // Migration 50: 分類系統欄位 - primary_topic
  `ALTER TABLE monitor_mentions ADD COLUMN primary_topic VARCHAR(32) NULL COMMENT '主要分類(pain_point/need_context/other)'`,

  // Migration 50b: 分類系統欄位 - classification_hits
  `ALTER TABLE monitor_mentions ADD COLUMN classification_hits JSON NULL COMMENT '分類命中詳情'`,

  // Migration 50c: 分類系統欄位 - classification_version
  `ALTER TABLE monitor_mentions ADD COLUMN classification_version VARCHAR(32) NULL COMMENT '分類規則版本'`,

  // Migration 50d: 分類系統欄位 - has_strong_hit
  `ALTER TABLE monitor_mentions ADD COLUMN has_strong_hit BOOLEAN DEFAULT FALSE COMMENT '是否有強命中'`,

  // Migration 50e: 分類系統索引
  `ALTER TABLE monitor_mentions ADD INDEX idx_primary_topic (primary_topic)`,

  // Migration 50f: 分類系統索引 - 強命中
  `ALTER TABLE monitor_mentions ADD INDEX idx_strong_hit (has_strong_hit, primary_topic, discovered_at DESC)`,

  // Migration 51: 補充 post_insights 缺少的欄位
  `ALTER TABLE post_insights ADD COLUMN shares INT UNSIGNED DEFAULT 0`,

  // Migration 52: 補充 post_insights 的 last_synced_at 欄位（允許 NULL 並有預設值）
  `ALTER TABLE post_insights ADD COLUMN last_synced_at DATETIME NULL DEFAULT NULL`,

  // Migration 53: 補充 post_insights 的 fetched_at 欄位
  `ALTER TABLE post_insights ADD COLUMN fetched_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP`,

  // Migration 54: 補充 post_insights 的 fetched_at 索引
  `ALTER TABLE post_insights ADD INDEX idx_fetched_at (fetched_at)`,

  // Migration 55: 修正 last_synced_at 欄位允許 NULL（如果已存在但設定錯誤）
  `ALTER TABLE post_insights MODIFY COLUMN last_synced_at DATETIME NULL DEFAULT NULL`,

  // Migration 56: 確保 post_insights 的 created_at 欄位有預設值
  `ALTER TABLE post_insights MODIFY COLUMN created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP`,

  // Migration 57: 為 daily_auto_schedule 的 status ENUM 添加 EXPIRED 狀態
  // 修復 scheduler.ts 中設定 status='EXPIRED' 導致的 Data truncated 錯誤
  `ALTER TABLE daily_auto_schedule
   MODIFY COLUMN status ENUM('PENDING', 'GENERATED', 'APPROVED', 'PUBLISHING', 'POSTED', 'FAILED', 'CANCELLED', 'EXPIRED') DEFAULT 'PENDING'`,

  // ========================================
  // Migration 58-60: 網黃偵測系統
  // ========================================

  // Migration 58: 網黃作者表 influencer_authors
  `
  CREATE TABLE IF NOT EXISTS influencer_authors (
    id CHAR(36) PRIMARY KEY,

    -- Dcard 資訊
    dcard_id VARCHAR(100) NULL COMMENT 'Dcard 用戶 ID',
    dcard_username VARCHAR(100) NULL COMMENT 'Dcard 用戶名稱',
    dcard_url VARCHAR(500) NULL COMMENT 'Dcard 個人頁面 URL',
    dcard_avatar_url VARCHAR(500) NULL COMMENT 'Dcard 頭像',
    dcard_bio TEXT NULL COMMENT 'Dcard 自我介紹原文',
    dcard_school VARCHAR(100) NULL COMMENT 'Dcard 學校標籤',
    dcard_post_count INT DEFAULT 0 COMMENT 'Dcard 文章數',

    -- Twitter 資訊
    twitter_id VARCHAR(100) NULL COMMENT 'Twitter ID/用戶名',
    twitter_url VARCHAR(500) NULL COMMENT 'Twitter 連結',
    twitter_display_name VARCHAR(100) NULL COMMENT 'Twitter 顯示名稱',
    twitter_followers INT NULL COMMENT 'Twitter 粉絲數',
    twitter_verified BOOLEAN DEFAULT FALSE COMMENT 'Twitter 是否認證',

    -- 其他社群連結
    instagram_id VARCHAR(100) NULL COMMENT 'Instagram ID',
    instagram_url VARCHAR(500) NULL,
    telegram_id VARCHAR(100) NULL COMMENT 'Telegram ID',
    telegram_url VARCHAR(500) NULL,
    other_links JSON NULL COMMENT '其他連結',

    -- 偵測資訊
    first_detected_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '首次偵測時間',
    last_seen_at DATETIME NULL COMMENT '最後看到時間',
    detection_count INT DEFAULT 1 COMMENT '偵測到次數',
    source_forum VARCHAR(50) DEFAULT 'sex' COMMENT '來源看板',

    -- 合作狀態
    status ENUM('new', 'pending', 'contacted', 'negotiating', 'cooperating', 'rejected', 'blacklisted') DEFAULT 'new' COMMENT '狀態',
    priority ENUM('low', 'medium', 'high', 'urgent') DEFAULT 'medium' COMMENT '優先度',

    -- 評估資訊
    estimated_followers INT NULL COMMENT '估計總粉絲數',
    content_style VARCHAR(100) NULL COMMENT '內容風格',
    cooperation_potential ENUM('low', 'medium', 'high') NULL COMMENT '合作潛力',
    notes TEXT NULL COMMENT '備註',
    tags JSON NULL COMMENT '標籤',

    -- 時間戳記
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    created_by CHAR(36) NULL,

    UNIQUE KEY uk_dcard_id (dcard_id),
    INDEX idx_twitter_id (twitter_id),
    INDEX idx_status (status),
    INDEX idx_priority (priority),
    INDEX idx_first_detected (first_detected_at DESC),
    INDEX idx_last_seen (last_seen_at DESC)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='網黃作者資料';
  `,

  // Migration 59: 合作記錄表 influencer_contacts
  `
  CREATE TABLE IF NOT EXISTS influencer_contacts (
    id CHAR(36) PRIMARY KEY,
    author_id CHAR(36) NOT NULL COMMENT '作者 ID',

    -- 聯絡資訊
    contact_date DATETIME NOT NULL COMMENT '聯絡日期',
    contact_method ENUM('twitter_dm', 'instagram_dm', 'telegram', 'email', 'dcard_msg', 'other') DEFAULT 'twitter_dm' COMMENT '聯絡方式',
    contact_platform VARCHAR(50) NULL COMMENT '聯絡平台',

    -- 聯絡內容
    subject VARCHAR(200) NULL COMMENT '主旨',
    message TEXT NULL COMMENT '聯絡內容',

    -- 結果
    result ENUM('no_response', 'responded', 'interested', 'negotiating', 'agreed', 'rejected', 'pending') DEFAULT 'pending' COMMENT '結果',
    response_content TEXT NULL COMMENT '回覆內容',
    response_date DATETIME NULL COMMENT '回覆日期',

    -- 後續
    next_action VARCHAR(200) NULL COMMENT '下一步行動',
    next_action_date DATETIME NULL COMMENT '下一步日期',
    follow_up_count INT DEFAULT 0 COMMENT '追蹤次數',

    -- 備註
    notes TEXT NULL COMMENT '備註',

    -- 時間戳記
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    created_by CHAR(36) NULL,

    FOREIGN KEY (author_id) REFERENCES influencer_authors(id) ON DELETE CASCADE,
    INDEX idx_author (author_id, contact_date DESC),
    INDEX idx_result (result),
    INDEX idx_next_action (next_action_date)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='網黃聯絡/合作記錄';
  `,

  // Migration 60: 偵測來源文章表 influencer_source_posts
  `
  CREATE TABLE IF NOT EXISTS influencer_source_posts (
    id CHAR(36) PRIMARY KEY,
    author_id CHAR(36) NOT NULL COMMENT '作者 ID',

    -- 文章資訊
    post_id VARCHAR(100) NOT NULL COMMENT 'Dcard 文章 ID',
    post_url VARCHAR(500) NOT NULL COMMENT '文章連結',
    post_title VARCHAR(500) NULL COMMENT '文章標題',
    post_excerpt TEXT NULL COMMENT '文章摘要',
    post_category VARCHAR(50) NULL COMMENT '文章分類',

    -- 互動數據
    likes_count INT DEFAULT 0,
    comments_count INT DEFAULT 0,

    -- 偵測資訊
    detected_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '偵測時間',
    detection_source ENUM('hot', 'latest', 'manual') DEFAULT 'latest' COMMENT '偵測來源',

    -- 時間戳記
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

    UNIQUE KEY uk_post_id (post_id),
    FOREIGN KEY (author_id) REFERENCES influencer_authors(id) ON DELETE CASCADE,
    INDEX idx_author (author_id, detected_at DESC),
    INDEX idx_detected (detected_at DESC)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='網黃偵測來源文章';
  `,

  // Migration 61: 偵測設定表 influencer_detection_config
  `
  CREATE TABLE IF NOT EXISTS influencer_detection_config (
    id CHAR(36) PRIMARY KEY,

    -- 偵測設定
    enabled BOOLEAN DEFAULT TRUE COMMENT '是否啟用自動偵測',
    detection_source ENUM('hot', 'latest', 'both') DEFAULT 'latest' COMMENT '偵測來源',
    check_interval_minutes INT DEFAULT 30 COMMENT '檢查間隔（分鐘）',
    max_posts_per_check INT DEFAULT 20 COMMENT '每次最多檢查幾篇',

    -- 目標看板
    target_forums JSON DEFAULT ('["sex"]') COMMENT '目標看板列表',

    -- 過濾設定
    min_likes INT DEFAULT 0 COMMENT '最低讚數門檻',
    keyword_filters JSON NULL COMMENT '關鍵字過濾',
    exclude_keywords JSON NULL COMMENT '排除關鍵字',

    -- Twitter 偵測設定
    twitter_patterns JSON DEFAULT ('["twitter.com", "x.com", "@"]') COMMENT 'Twitter 偵測模式',

    -- 通知設定
    notify_on_new BOOLEAN DEFAULT TRUE COMMENT '發現新作者時通知',
    notify_line_user_id VARCHAR(100) NULL COMMENT 'LINE 通知接收者',

    -- 上次執行
    last_check_at DATETIME NULL COMMENT '上次檢查時間',
    last_check_result JSON NULL COMMENT '上次檢查結果',

    -- 時間戳記
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='網黃偵測設定';
  `,

  // Migration 62: 插入預設偵測設定
  `
  INSERT IGNORE INTO influencer_detection_config (id, enabled, detection_source, check_interval_minutes)
  VALUES (UUID(), TRUE, 'latest', 30);
  `,

  // Migration 63: 系統設定表
  `
  CREATE TABLE IF NOT EXISTS system_settings (
    id CHAR(36) PRIMARY KEY,
    setting_key VARCHAR(100) NOT NULL UNIQUE,
    setting_value TEXT,
    setting_type VARCHAR(50) DEFAULT 'string',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_setting_key (setting_key)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `,

  // Migration 64: 新增 Twitter 驗證時間欄位
  `ALTER TABLE influencer_authors ADD COLUMN twitter_verified_at DATETIME NULL COMMENT 'Twitter ID 驗證時間' AFTER twitter_verified`,

  // Migration 65: 合作記錄表（簡化版）
  `
  CREATE TABLE IF NOT EXISTS influencer_cooperations (
    id CHAR(36) PRIMARY KEY,
    author_id CHAR(36) NOT NULL COMMENT '作者 ID',

    -- 聯絡資訊
    first_contact_at DATETIME NOT NULL COMMENT '首次聯絡時間',

    -- 合作狀態
    cooperated BOOLEAN DEFAULT FALSE COMMENT '是否合作',

    -- 發文資訊（合作成功時填寫）
    post_url VARCHAR(500) NULL COMMENT '發文網址',
    payment_amount DECIMAL(10, 2) NULL COMMENT '合作金額',
    post_date DATE NULL COMMENT '發文日期',

    -- 備註
    notes TEXT NULL COMMENT '備註',

    -- 時間戳記
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    FOREIGN KEY (author_id) REFERENCES influencer_authors(id) ON DELETE CASCADE,
    INDEX idx_author (author_id),
    INDEX idx_cooperated (cooperated),
    INDEX idx_post_date (post_date DESC)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='網黃合作記錄';
  `,

  // Migration 66: 新增活躍度欄位
  `ALTER TABLE influencer_authors
   ADD COLUMN last_dcard_post_at DATETIME NULL COMMENT 'Dcard 最後發文時間' AFTER last_seen_at,
   ADD COLUMN last_twitter_post_at DATETIME NULL COMMENT 'Twitter 最後發文時間' AFTER last_dcard_post_at`,

  // Migration 67: 爬蟲全域設定表
  `CREATE TABLE IF NOT EXISTS scraper_config (
    id INT PRIMARY KEY DEFAULT 1,
    poll_interval_seconds INT DEFAULT 60 COMMENT '爬蟲輪詢間隔（秒）',
    max_concurrent_tasks INT DEFAULT 3 COMMENT '每次最多回傳幾個任務',
    offline_fallback_hours INT DEFAULT 4 COMMENT '離線時的備用間隔（小時）',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='爬蟲全域設定'`,

  // Migration 68: 插入預設爬蟲設定
  `INSERT IGNORE INTO scraper_config (id, poll_interval_seconds, max_concurrent_tasks, offline_fallback_hours)
   VALUES (1, 60, 3, 4)`,

  // Migration 69: 品牌表新增 last_trends_at 欄位
  `ALTER TABLE monitor_brands ADD COLUMN last_trends_at DATETIME NULL COMMENT '最後趨勢更新時間' AFTER last_crawled_at`,
];

async function runMigrations() {
  let connection: mysql.Connection | null = null;

  try {
    console.log('Starting database migrations...');

    connection = await mysql.createConnection({
      host: config.database.host,
      port: config.database.port,
      user: config.database.user,
      password: config.database.password,
      database: config.database.database,
      multipleStatements: true,
    });

    for (let i = 0; i < migrations.length; i++) {
      console.log(`Running migration ${i + 1}/${migrations.length}...`);
      try {
        await connection.query(migrations[i]);
      } catch (error: any) {
        // Ignore errors for migrations that might already be applied
        // (e.g., "Duplicate column name" for ADD COLUMN)
        if (error.code === 'ER_DUP_FIELDNAME' || error.code === 'ER_DUP_KEYNAME') {
          console.log(`  ⚠ Migration ${i + 1} already applied, skipping...`);
        } else {
          throw error;
        }
      }
    }

    console.log('✓ All migrations completed successfully!');
  } catch (error) {
    console.error('✗ Migration failed:', error);
    throw error;
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

// Run migrations if called directly
if (require.main === module) {
  runMigrations()
    .then(() => {
      console.log('Migration process completed.');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Migration process failed:', error);
      process.exit(1);
    });
}

export default runMigrations;
