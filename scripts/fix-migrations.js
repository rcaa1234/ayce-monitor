/**
 * 修正 migration 問題
 * 用途：手動建立剩餘的表（post_performance_log 和 daily_scheduled_posts）
 * 原因：字符集不一致導致外鍵建立失敗，改用不檢查外鍵的方式
 */
const mysql = require('mysql2/promise');
require('dotenv').config({ path: '.env.local' });

async function fixMigrations() {
  console.log('🔧 修正 Migration...\n');

  const conn = await mysql.createConnection({
    host: process.env.MYSQL_HOST || 'localhost',
    user: 'root',
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
  });

  try {
    // 先刪除可能存在的表（重新開始）
    console.log('清理舊表...');
    await conn.execute('DROP TABLE IF EXISTS daily_scheduled_posts');
    await conn.execute('DROP TABLE IF EXISTS post_performance_log');
    console.log('✓ 清理完成\n');

    // 建立 post_performance_log（不使用外鍵，改用應用層控制）
    console.log('建立 post_performance_log...');
    await conn.execute(`
      CREATE TABLE post_performance_log (
        id CHAR(36) PRIMARY KEY,
        post_id CHAR(36) NOT NULL COMMENT '關聯的貼文 ID',
        template_id CHAR(36) NULL COMMENT '使用的模板 ID（NULL 表示手動輸入）',

        -- 發文時間資訊
        posted_at DATETIME NOT NULL COMMENT '實際發文時間',
        posted_hour TINYINT UNSIGNED NOT NULL COMMENT '發文小時 (0-23)',
        posted_minute TINYINT UNSIGNED NOT NULL COMMENT '發文分鐘 (0-59)',
        day_of_week TINYINT UNSIGNED NOT NULL COMMENT '星期 (0=日, 1=一, ..., 6=六)',

        -- 表現數據
        views INT UNSIGNED DEFAULT 0 COMMENT '瀏覽數',
        likes INT UNSIGNED DEFAULT 0 COMMENT '按讚數',
        replies INT UNSIGNED DEFAULT 0 COMMENT '回覆數',
        engagement_rate DECIMAL(5,2) DEFAULT 0.00 COMMENT '互動率（%）',

        -- AI 決策記錄
        selection_method ENUM('MANUAL', 'EXPLORATION', 'EXPLOITATION', 'RANDOM') DEFAULT 'MANUAL',
        ucb_score DECIMAL(10,4) NULL,

        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

        INDEX idx_post_id (post_id),
        INDEX idx_template_time (template_id, posted_hour, posted_minute),
        INDEX idx_performance (engagement_rate DESC),
        INDEX idx_posted_at (posted_at DESC)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
        COMMENT='發文表現記錄表';
    `);
    console.log('✓ post_performance_log 建立完成\n');

    // 建立 daily_scheduled_posts
    console.log('建立 daily_scheduled_posts...');
    await conn.execute(`
      CREATE TABLE daily_scheduled_posts (
        id CHAR(36) PRIMARY KEY,
        template_id CHAR(36) NOT NULL COMMENT '使用的模板 ID',
        scheduled_time DATETIME NOT NULL COMMENT '預定發文時間',
        post_id CHAR(36) NULL COMMENT '生成的貼文 ID',

        status ENUM('PENDING', 'GENERATED', 'POSTED', 'FAILED', 'CANCELLED') DEFAULT 'PENDING',

        selection_method ENUM('MANUAL', 'EXPLORATION', 'EXPLOITATION') DEFAULT 'MANUAL',
        ucb_score DECIMAL(10,4) NULL,

        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

        INDEX idx_template_id (template_id),
        INDEX idx_post_id (post_id),
        INDEX idx_scheduled_time (scheduled_time),
        INDEX idx_status (status),
        UNIQUE KEY uk_scheduled_time (scheduled_time)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
        COMMENT='每日發文排程表';
    `);
    console.log('✓ daily_scheduled_posts 建立完成\n');

    console.log('✅ 所有表已成功建立！\n');

    // 驗證
    console.log('驗證建立的表:');
    const [tables] = await conn.execute(`
      SELECT table_name, table_comment
      FROM information_schema.tables
      WHERE table_schema = ? AND table_name IN (
        'content_templates',
        'posting_schedule_config',
        'post_performance_log',
        'daily_scheduled_posts'
      )
    `, [process.env.MYSQL_DATABASE]);

    tables.forEach(t => {
      console.log(`  ✓ ${t.TABLE_NAME} - ${t.TABLE_COMMENT}`);
    });

  } finally {
    await conn.end();
  }
}

fixMigrations().catch(console.error);
