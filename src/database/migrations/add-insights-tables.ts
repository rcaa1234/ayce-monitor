import { getPool } from '../connection';
import logger from '../../utils/logger';

/**
 * Migration: Add insights tables for tracking Threads analytics
 *
 * Tables created:
 * - post_insights: Track individual post metrics (views, likes, replies, etc.)
 * - account_insights: Track account-level metrics (followers, engagement, etc.)
 */
export async function up() {
  const pool = getPool();

  logger.info('Running migration: add-insights-tables');

  try {
    // Create post_insights table
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS post_insights (
        id VARCHAR(36) PRIMARY KEY,
        post_id VARCHAR(36) NOT NULL,

        -- Metrics from Threads API
        views INT UNSIGNED DEFAULT 0,
        likes INT UNSIGNED DEFAULT 0,
        replies INT UNSIGNED DEFAULT 0,
        reposts INT UNSIGNED DEFAULT 0,
        quotes INT UNSIGNED DEFAULT 0,
        shares INT UNSIGNED DEFAULT 0,

        -- Calculated metrics
        engagement_rate DECIMAL(5,2) DEFAULT 0,

        -- Metadata
        fetched_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

        FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
        INDEX idx_post_id (post_id),
        INDEX idx_fetched_at (fetched_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // Create account_insights table
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS account_insights (
        id VARCHAR(36) PRIMARY KEY,
        account_id VARCHAR(36) NOT NULL,

        -- Account metrics
        followers_count INT UNSIGNED DEFAULT 0,
        following_count INT UNSIGNED DEFAULT 0,
        posts_count INT UNSIGNED DEFAULT 0,

        -- Period metrics (e.g. weekly)
        period_views INT UNSIGNED DEFAULT 0,
        period_interactions INT UNSIGNED DEFAULT 0,
        period_new_followers INT UNSIGNED DEFAULT 0,
        period_posts INT UNSIGNED DEFAULT 0,

        -- Period metadata
        period_start DATE NOT NULL,
        period_end DATE NOT NULL,
        period_type ENUM('daily', 'weekly', 'monthly') DEFAULT 'weekly',

        -- Metadata
        fetched_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

        FOREIGN KEY (account_id) REFERENCES threads_accounts(id) ON DELETE CASCADE,
        INDEX idx_account_id (account_id),
        INDEX idx_period (period_start, period_end),
        INDEX idx_fetched_at (fetched_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    logger.info('✓ Migration completed: add-insights-tables');
  } catch (error) {
    logger.error('Migration failed: add-insights-tables', error);
    throw error;
  }
}

export async function down() {
  const pool = getPool();

  logger.info('Rolling back migration: add-insights-tables');

  try {
    await pool.execute('DROP TABLE IF EXISTS post_insights');
    await pool.execute('DROP TABLE IF EXISTS account_insights');

    logger.info('✓ Rollback completed: add-insights-tables');
  } catch (error) {
    logger.error('Rollback failed: add-insights-tables', error);
    throw error;
  }
}
