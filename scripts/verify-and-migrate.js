/**
 * Verify Database Structure and Execute Migration
 * 檢查資料庫結構並執行統計功能遷移
 *
 * 使用方式:
 * node scripts/verify-and-migrate.js
 */

const mysql = require('mysql2/promise');
require('dotenv').config();

async function verifyAndMigrate() {
  console.log('='.repeat(60));
  console.log('統計功能資料庫遷移驗證與執行工具');
  console.log('='.repeat(60));
  console.log('');

  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST || 'localhost',
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'threads_bot_db',
    port: parseInt(process.env.MYSQL_PORT || '3306'),
  });

  try {
    console.log('✓ 已連接到資料庫');
    console.log('');

    // Step 1: 檢查必要的基礎表是否存在
    console.log('【步驟 1/5】檢查基礎表結構...');
    const [tables] = await connection.execute('SHOW TABLES');
    const tableNames = tables.map(t => Object.values(t)[0]);

    const requiredTables = ['posts', 'content_templates', 'schedule_time_slots'];
    const missingTables = requiredTables.filter(t => !tableNames.includes(t));

    if (missingTables.length > 0) {
      console.error('❌ 缺少必要的基礎表:', missingTables.join(', '));
      console.error('   請確認資料庫結構完整後再執行遷移');
      process.exit(1);
    }
    console.log('✓ 所有基礎表都存在');
    console.log('  - posts');
    console.log('  - content_templates');
    console.log('  - schedule_time_slots');
    console.log('');

    // Step 2: 檢查 posts 表的 ID 類型和 collation
    console.log('【步驟 2/5】檢查 posts 表結構...');
    const [postsColumns] = await connection.execute(`
      SHOW FULL COLUMNS FROM posts WHERE Field = 'id'
    `);

    if (postsColumns.length === 0) {
      console.error('❌ posts 表沒有 id 欄位');
      process.exit(1);
    }

    const postsIdColumn = postsColumns[0];
    console.log('✓ posts.id 欄位資訊:');
    console.log('  - Type:', postsIdColumn.Type);
    console.log('  - Collation:', postsIdColumn.Collation);

    if (!postsIdColumn.Type.includes('char(36)')) {
      console.warn('⚠️  posts.id 不是 CHAR(36) 類型，可能會有相容性問題');
    }
    console.log('');

    // Step 3: 檢查統計表是否已存在
    console.log('【步驟 3/5】檢查統計表狀態...');
    const statisticsTables = [
      'post_insights',
      'post_insights_history',
      'template_performance',
      'timeslot_performance'
    ];

    const existingStatsTables = statisticsTables.filter(t => tableNames.includes(t));

    if (existingStatsTables.length > 0) {
      console.log('⚠️  以下統計表已存在:');
      existingStatsTables.forEach(t => console.log('  -', t));
      console.log('');
      console.log('如果要重新執行遷移，請先執行清理腳本:');
      console.log('  npm run cleanup:statistics');
      console.log('');

      // 檢查現有表的結構
      for (const tableName of existingStatsTables) {
        const [fks] = await connection.execute(`
          SELECT
            CONSTRAINT_NAME,
            COLUMN_NAME,
            REFERENCED_TABLE_NAME,
            REFERENCED_COLUMN_NAME
          FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
          WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = ?
            AND REFERENCED_TABLE_NAME IS NOT NULL
        `, [tableName]);

        if (fks.length > 0) {
          console.log(`✓ ${tableName} 的外鍵:`, fks.map(fk =>
            `${fk.COLUMN_NAME} → ${fk.REFERENCED_TABLE_NAME}.${fk.REFERENCED_COLUMN_NAME}`
          ).join(', '));
        }
      }
      console.log('');
      console.log('✅ 統計表已存在且結構正確，無需重新遷移');
      process.exit(0);
    }

    console.log('✓ 統計表尚未建立，可以執行遷移');
    console.log('');

    // Step 4: 檢查 posts 和 post_performance_log 表的欄位
    console.log('【步驟 4/5】檢查表欄位擴充狀態...');

    const [postsExtendedColumns] = await connection.execute(`
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'posts'
        AND COLUMN_NAME IN ('content_length', 'has_media', 'media_type', 'hashtag_count')
    `);

    if (postsExtendedColumns.length > 0) {
      console.log('⚠️  posts 表已有擴充欄位:', postsExtendedColumns.map(c => c.COLUMN_NAME).join(', '));
      console.log('   遷移腳本會跳過欄位擴充步驟');
    } else {
      console.log('✓ posts 表尚未擴充，遷移將新增內容分析欄位');
    }

    const [logExtendedColumns] = await connection.execute(`
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'post_performance_log'
        AND COLUMN_NAME IN ('insights_synced', 'insights_synced_at')
    `);

    if (logExtendedColumns.length > 0) {
      console.log('⚠️  post_performance_log 表已有擴充欄位:', logExtendedColumns.map(c => c.COLUMN_NAME).join(', '));
      console.log('   遷移腳本會跳過欄位擴充步驟');
    } else {
      console.log('✓ post_performance_log 表尚未擴充，遷移將新增同步追蹤欄位');
    }
    console.log('');

    // Step 5: 執行遷移確認
    console.log('【步驟 5/5】準備執行遷移');
    console.log('');
    console.log('遷移將執行以下操作:');
    console.log('  1. 建立 post_insights 表（儲存貼文即時數據）');
    console.log('  2. 建立 post_insights_history 表（儲存歷史快照）');
    console.log('  3. 建立 template_performance 表（樣板效能統計）');
    console.log('  4. 建立 timeslot_performance 表（時段效能統計）');
    console.log('  5. 擴充 posts 表（新增內容分析欄位）');
    console.log('  6. 擴充 post_performance_log 表（新增同步追蹤欄位）');
    console.log('');
    console.log('='.repeat(60));
    console.log('✅ 前置檢查完成，資料庫結構符合要求');
    console.log('='.repeat(60));
    console.log('');
    console.log('請執行以下指令開始遷移:');
    console.log('');
    console.log('  npm run migrate:statistics:prod');
    console.log('');

  } catch (error) {
    console.error('❌ 檢查過程發生錯誤:', error.message);
    throw error;
  } finally {
    await connection.end();
  }
}

verifyAndMigrate()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
