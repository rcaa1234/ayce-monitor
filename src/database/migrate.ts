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
