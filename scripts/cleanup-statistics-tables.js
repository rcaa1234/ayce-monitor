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

    // Check and remove posts table extended columns one by one
    console.log('\nChecking posts table extended columns...');
    const [columns] = await connection.execute(`
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'posts'
        AND COLUMN_NAME IN ('template_id', 'time_slot_id', 'content_length', 'has_media', 'media_type', 'hashtag_count')
    `);

    if (columns.length > 0) {
      console.log('Removing extended columns from posts table...');
      const columnsToRemove = columns.map(c => c.COLUMN_NAME);

      // Remove foreign keys first if they exist
      if (columnsToRemove.includes('template_id')) {
        try {
          await connection.execute('ALTER TABLE posts DROP FOREIGN KEY fk_posts_template');
          console.log('  ✓ Dropped foreign key fk_posts_template');
        } catch (e) {
          // FK might not exist, continue
        }
      }

      if (columnsToRemove.includes('time_slot_id')) {
        try {
          await connection.execute('ALTER TABLE posts DROP FOREIGN KEY fk_posts_timeslot');
          console.log('  ✓ Dropped foreign key fk_posts_timeslot');
        } catch (e) {
          // FK might not exist, continue
        }
      }

      // Remove columns one by one
      for (const col of columnsToRemove) {
        await connection.execute(`ALTER TABLE posts DROP COLUMN ${col}`);
        console.log(`  ✓ Dropped column ${col}`);
      }

      console.log('✓ Removed all extended columns from posts');
    } else {
      console.log('✓ No extended columns to remove from posts');
    }

    // Check and remove post_performance_log extended columns one by one
    console.log('\nChecking post_performance_log table extended columns...');
    const [logColumns] = await connection.execute(`
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'post_performance_log'
        AND COLUMN_NAME IN ('insights_synced', 'insights_synced_at')
    `);

    if (logColumns.length > 0) {
      console.log('Removing extended columns from post_performance_log table...');
      const logColumnsToRemove = logColumns.map(c => c.COLUMN_NAME);

      for (const col of logColumnsToRemove) {
        await connection.execute(`ALTER TABLE post_performance_log DROP COLUMN ${col}`);
        console.log(`  ✓ Dropped column ${col}`);
      }

      console.log('✓ Removed all extended columns from post_performance_log');
    } else {
      console.log('✓ No extended columns to remove from post_performance_log');
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
