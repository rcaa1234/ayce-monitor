/**
 * List All Tables
 * 列出資料庫中的所有表
 */

const mysql = require('mysql2/promise');
require('dotenv').config();

async function listTables() {
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

    const [tables] = await connection.execute('SHOW TABLES');

    console.log('=== ALL TABLES ===');
    tables.forEach((row) => {
      const tableName = Object.values(row)[0];
      console.log(`- ${tableName}`);
    });

    console.log('\n=== SEARCHING FOR TEMPLATE/CONTENT TABLES ===');
    const [templateTables] = await connection.execute(
      "SHOW TABLES LIKE '%template%'"
    );

    if (templateTables.length > 0) {
      console.log('Template-related tables found:');
      templateTables.forEach((row) => {
        console.log(`- ${Object.values(row)[0]}`);
      });
    } else {
      console.log('⚠️  No template-related tables found');
    }

    const [contentTables] = await connection.execute(
      "SHOW TABLES LIKE '%content%'"
    );

    if (contentTables.length > 0) {
      console.log('\nContent-related tables found:');
      contentTables.forEach((row) => {
        console.log(`- ${Object.values(row)[0]}`);
      });
    } else {
      console.log('⚠️  No content-related tables found');
    }

  } catch (error) {
    console.error('❌ Failed:', error.message);
    throw error;
  } finally {
    await connection.end();
  }
}

listTables()
  .then(() => {
    console.log('\n✅ Done');
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
