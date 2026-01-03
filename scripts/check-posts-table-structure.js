/**
 * Check Posts Table Structure
 * 檢查 posts 表的實際欄位類型
 */

const mysql = require('mysql2/promise');
require('dotenv').config();

async function checkStructure() {
  console.log('Connecting to database...');

  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST || 'localhost',
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'threads_bot_db',
    port: parseInt(process.env.MYSQL_PORT || '3306'),
  });

  try {
    console.log('✓ Connected to database\n');

    // Check posts table structure
    console.log('=== POSTS TABLE STRUCTURE ===');
    const [postsColumns] = await connection.execute(`
      SHOW COLUMNS FROM posts WHERE Field = 'id'
    `);

    console.log('posts.id column:');
    console.log(JSON.stringify(postsColumns, null, 2));

    // Check if post_insights table exists
    const [tables] = await connection.execute(`
      SHOW TABLES LIKE 'post_insights'
    `);

    if (tables.length > 0) {
      console.log('\n=== POST_INSIGHTS TABLE STRUCTURE ===');
      const [insightsColumns] = await connection.execute(`
        SHOW COLUMNS FROM post_insights WHERE Field IN ('id', 'post_id')
      `);
      console.log('post_insights columns:');
      console.log(JSON.stringify(insightsColumns, null, 2));

      // Check foreign keys
      console.log('\n=== POST_INSIGHTS FOREIGN KEYS ===');
      const [fks] = await connection.execute(`
        SELECT
          CONSTRAINT_NAME,
          COLUMN_NAME,
          REFERENCED_TABLE_NAME,
          REFERENCED_COLUMN_NAME
        FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'post_insights'
          AND REFERENCED_TABLE_NAME IS NOT NULL
      `);
      console.log(JSON.stringify(fks, null, 2));
    } else {
      console.log('\n⚠️  post_insights table does not exist');
    }

    // Check post_insights_history if exists
    const [historyTables] = await connection.execute(`
      SHOW TABLES LIKE 'post_insights_history'
    `);

    if (historyTables.length > 0) {
      console.log('\n=== POST_INSIGHTS_HISTORY TABLE STRUCTURE ===');
      const [historyColumns] = await connection.execute(`
        SHOW COLUMNS FROM post_insights_history WHERE Field IN ('id', 'post_id')
      `);
      console.log('post_insights_history columns:');
      console.log(JSON.stringify(historyColumns, null, 2));
    } else {
      console.log('\n⚠️  post_insights_history table does not exist');
    }

  } catch (error) {
    console.error('❌ Check failed:', error.message);
    throw error;
  } finally {
    await connection.end();
  }
}

checkStructure()
  .then(() => {
    console.log('\n✅ Check completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
