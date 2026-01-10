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
  `
  ALTER TABLE daily_auto_schedule
  MODIFY COLUMN status ENUM('PENDING', 'GENERATED', 'APPROVED', 'POSTED', 'FAILED', 'CANCELLED') DEFAULT 'PENDING';
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
