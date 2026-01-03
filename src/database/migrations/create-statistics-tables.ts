/**
 * Statistics Feature Database Migration
 * Creates 4 new tables and extends 2 existing tables
 */

import { Pool } from 'mysql2/promise';
import { getPool, createDatabasePool } from '../connection';
import logger from '../../utils/logger';

export async function up(): Promise<void> {
  const pool = getPool();
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    logger.info('Starting statistics tables migration...');

    // 1. Create post_insights table
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS post_insights (
        id CHAR(36) PRIMARY KEY,
        post_id CHAR(36) NOT NULL,
        likes INT DEFAULT 0,
        replies INT DEFAULT 0,
        reposts INT DEFAULT 0,
        quotes INT DEFAULT 0,
        views INT DEFAULT 0,
        reach INT DEFAULT 0,
        engagement_rate DECIMAL(5,2) DEFAULT 0.00 COMMENT '參與率 (%)',
        last_synced_at DATETIME NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
        UNIQUE KEY unique_post (post_id),
        INDEX idx_last_synced (last_synced_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
    logger.info('✓ Created post_insights table');

    // 2. Create post_insights_history table
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS post_insights_history (
        id CHAR(36) PRIMARY KEY,
        post_id CHAR(36) NOT NULL,
        snapshot_date DATE NOT NULL COMMENT '快照日期',
        likes INT DEFAULT 0,
        replies INT DEFAULT 0,
        reposts INT DEFAULT 0,
        quotes INT DEFAULT 0,
        views INT DEFAULT 0,
        reach INT DEFAULT 0,
        engagement_rate DECIMAL(5,2) DEFAULT 0.00,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
        UNIQUE KEY unique_post_snapshot (post_id, snapshot_date),
        INDEX idx_snapshot_date (snapshot_date)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
    logger.info('✓ Created post_insights_history table');

    // 3. Create template_performance table
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS template_performance (
        id CHAR(36) PRIMARY KEY,
        template_id CHAR(36) NOT NULL,
        stat_date DATE NOT NULL COMMENT '統計日期',
        posts_count INT DEFAULT 0 COMMENT '使用次數',
        avg_likes DECIMAL(10,2) DEFAULT 0.00,
        avg_replies DECIMAL(10,2) DEFAULT 0.00,
        avg_reposts DECIMAL(10,2) DEFAULT 0.00,
        avg_views DECIMAL(10,2) DEFAULT 0.00,
        avg_reach DECIMAL(10,2) DEFAULT 0.00,
        avg_engagement_rate DECIMAL(5,2) DEFAULT 0.00,
        total_likes INT DEFAULT 0,
        total_replies INT DEFAULT 0,
        total_reposts INT DEFAULT 0,
        total_views INT DEFAULT 0,
        avg_content_length DECIMAL(10,2) DEFAULT 0.00 COMMENT '平均內容長度',
        hashtag_usage_count INT DEFAULT 0 COMMENT 'hashtag 使用次數',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (template_id) REFERENCES post_templates(id) ON DELETE CASCADE,
        UNIQUE KEY unique_template_date (template_id, stat_date),
        INDEX idx_stat_date (stat_date)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
    logger.info('✓ Created template_performance table');

    // 4. Create timeslot_performance table
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS timeslot_performance (
        id CHAR(36) PRIMARY KEY,
        timeslot_id CHAR(36) NOT NULL,
        stat_date DATE NOT NULL,
        posts_count INT DEFAULT 0,
        avg_likes DECIMAL(10,2) DEFAULT 0.00,
        avg_replies DECIMAL(10,2) DEFAULT 0.00,
        avg_reposts DECIMAL(10,2) DEFAULT 0.00,
        avg_views DECIMAL(10,2) DEFAULT 0.00,
        avg_reach DECIMAL(10,2) DEFAULT 0.00,
        avg_engagement_rate DECIMAL(5,2) DEFAULT 0.00,
        total_likes INT DEFAULT 0,
        total_replies INT DEFAULT 0,
        total_reposts INT DEFAULT 0,
        total_views INT DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (timeslot_id) REFERENCES time_slots(id) ON DELETE CASCADE,
        UNIQUE KEY unique_timeslot_date (timeslot_id, stat_date),
        INDEX idx_stat_date (stat_date)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
    logger.info('✓ Created timeslot_performance table');

    // 5. Extend posts table with content analysis fields
    const [postsColumns] = await connection.execute(`
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'posts'
        AND COLUMN_NAME IN ('content_length', 'has_media', 'media_type', 'hashtag_count')
    `);

    if ((postsColumns as any[]).length === 0) {
      await connection.execute(`
        ALTER TABLE posts
          ADD COLUMN content_length INT DEFAULT 0 COMMENT '內容字數',
          ADD COLUMN has_media BOOLEAN DEFAULT FALSE COMMENT '是否含圖片/影片',
          ADD COLUMN media_type ENUM('NONE', 'IMAGE', 'VIDEO', 'CAROUSEL') DEFAULT 'NONE',
          ADD COLUMN hashtag_count INT DEFAULT 0 COMMENT 'hashtag 數量',
          ADD INDEX idx_content_length (content_length),
          ADD INDEX idx_media_type (media_type)
      `);
      logger.info('✓ Extended posts table with content analysis fields');
    } else {
      logger.info('✓ Posts table already has content analysis fields');
    }

    // 6. Extend post_performance_log table with insights sync tracking
    const [logColumns] = await connection.execute(`
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'post_performance_log'
        AND COLUMN_NAME IN ('insights_synced', 'insights_synced_at')
    `);

    if ((logColumns as any[]).length === 0) {
      await connection.execute(`
        ALTER TABLE post_performance_log
          ADD COLUMN insights_synced BOOLEAN DEFAULT FALSE COMMENT '是否已同步 Insights',
          ADD COLUMN insights_synced_at DATETIME NULL COMMENT 'Insights 同步時間',
          ADD INDEX idx_insights_synced (insights_synced)
      `);
      logger.info('✓ Extended post_performance_log table with insights sync tracking');
    } else {
      logger.info('✓ Post_performance_log table already has insights sync fields');
    }

    await connection.commit();
    logger.info('✅ Statistics tables migration completed successfully');

  } catch (error) {
    await connection.rollback();
    logger.error('❌ Statistics tables migration failed:', error);
    throw error;
  } finally {
    connection.release();
  }
}

export async function down(): Promise<void> {
  const pool = getPool();
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    logger.info('Rolling back statistics tables migration...');

    // Drop tables in reverse order (respecting foreign key constraints)
    await connection.execute('DROP TABLE IF EXISTS timeslot_performance');
    await connection.execute('DROP TABLE IF EXISTS template_performance');
    await connection.execute('DROP TABLE IF EXISTS post_insights_history');
    await connection.execute('DROP TABLE IF EXISTS post_insights');

    // Remove added columns from posts table
    await connection.execute(`
      ALTER TABLE posts
        DROP COLUMN IF EXISTS content_length,
        DROP COLUMN IF EXISTS has_media,
        DROP COLUMN IF EXISTS media_type,
        DROP COLUMN IF EXISTS hashtag_count
    `);

    // Remove added columns from post_performance_log table
    await connection.execute(`
      ALTER TABLE post_performance_log
        DROP COLUMN IF EXISTS insights_synced,
        DROP COLUMN IF EXISTS insights_synced_at
    `);

    await connection.commit();
    logger.info('✅ Statistics tables rollback completed');

  } catch (error) {
    await connection.rollback();
    logger.error('❌ Statistics tables rollback failed:', error);
    throw error;
  } finally {
    connection.release();
  }
}

// Allow running migration from command line
if (require.main === module) {
  // Initialize database connection
  createDatabasePool();

  up()
    .then(() => {
      console.log('Migration completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Migration failed:', error);
      process.exit(1);
    });
}
