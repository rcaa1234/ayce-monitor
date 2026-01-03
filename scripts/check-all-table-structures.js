/**
 * Check All Table Structures
 * 檢查所有相關表的完整欄位結構
 */

const mysql = require('mysql2/promise');
require('dotenv').config();

async function checkStructures() {
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

    const tables = [
      'posts',
      'content_templates',
      'schedule_time_slots',
      'post_insights',
      'post_insights_history',
      'template_performance',
      'timeslot_performance'
    ];

    for (const table of tables) {
      console.log(`\n${'='.repeat(60)}`);
      console.log(`TABLE: ${table}`);
      console.log('='.repeat(60));

      const [columns] = await connection.execute(`SHOW COLUMNS FROM ${table}`);

      console.log('\nColumns:');
      columns.forEach(col => {
        console.log(`  - ${col.Field.padEnd(25)} ${col.Type.padEnd(20)} ${col.Null === 'YES' ? 'NULL' : 'NOT NULL'}`);
      });
    }

    console.log('\n' + '='.repeat(60));
    console.log('✅ Check completed');
    console.log('='.repeat(60));

  } catch (error) {
    console.error('❌ Check failed:', error.message);
    throw error;
  } finally {
    await connection.end();
  }
}

checkStructures()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
