/**
 * Cleanup Statistics Tables
 * 刪除統計相關的表，以便重新執行遷移
 */

const mysql = require('mysql2/promise');
require('dotenv').config();

async function cleanup() {
  console.log('Connecting to database...');

  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST || 'localhost',
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'threads_bot_db',
    port: parseInt(process.env.MYSQL_PORT || '3306'),
  });

  try {
    console.log('✓ Connected to database');

    // Drop tables in reverse order (respect foreign key constraints)
    console.log('\nDropping statistics tables...');

    await connection.execute('DROP TABLE IF EXISTS timeslot_performance');
    console.log('✓ Dropped timeslot_performance');

    await connection.execute('DROP TABLE IF EXISTS template_performance');
    console.log('✓ Dropped template_performance');

    await connection.execute('DROP TABLE IF EXISTS post_insights_history');
    console.log('✓ Dropped post_insights_history');

    await connection.execute('DROP TABLE IF EXISTS post_insights');
    console.log('✓ Dropped post_insights');

    // Check if posts table has extended columns
    const [columns] = await connection.execute(`
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'posts'
        AND COLUMN_NAME IN ('content_length', 'has_media', 'media_type', 'hashtag_count')
    `);

    if (columns.length > 0) {
      console.log('\nRemoving extended columns from posts table...');
      await connection.execute(`
        ALTER TABLE posts
          DROP COLUMN IF EXISTS content_length,
          DROP COLUMN IF EXISTS has_media,
          DROP COLUMN IF EXISTS media_type,
          DROP COLUMN IF EXISTS hashtag_count
      `);
      console.log('✓ Removed extended columns from posts');
    }

    // Check if post_performance_log has extended columns
    const [logColumns] = await connection.execute(`
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'post_performance_log'
        AND COLUMN_NAME IN ('insights_synced', 'insights_synced_at')
    `);

    if (logColumns.length > 0) {
      console.log('\nRemoving extended columns from post_performance_log table...');
      await connection.execute(`
        ALTER TABLE post_performance_log
          DROP COLUMN IF EXISTS insights_synced,
          DROP COLUMN IF EXISTS insights_synced_at
      `);
      console.log('✓ Removed extended columns from post_performance_log');
    }

    console.log('\n✅ Cleanup completed successfully!');
    console.log('You can now run: npm run migrate:statistics:prod');

  } catch (error) {
    console.error('❌ Cleanup failed:', error.message);
    throw error;
  } finally {
    await connection.end();
  }
}

cleanup()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
