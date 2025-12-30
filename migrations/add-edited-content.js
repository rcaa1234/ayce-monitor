const mysql = require('mysql2/promise');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');

// Load .env.local
const envPath = path.resolve(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

async function addEditedContentColumn() {
  let connection;
  try {
    connection = await mysql.createConnection({
      host: process.env.MYSQL_HOST || 'localhost',
      port: parseInt(process.env.MYSQL_PORT || '3306'),
      user: process.env.MYSQL_USER || 'root',
      password: process.env.MYSQL_PASSWORD || '',
      database: process.env.MYSQL_DATABASE || 'threads_posting',
    });

    console.log('✓ Connected to database');

    // Check if column exists
    const [columns] = await connection.query(`
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'review_requests'
      AND COLUMN_NAME = 'edited_content'
    `);

    if (columns.length === 0) {
      // Add edited_content column to review_requests table
      await connection.query(`
        ALTER TABLE review_requests
        ADD COLUMN edited_content MEDIUMTEXT NULL
        AFTER revision_id
      `);
      console.log('✓ Added edited_content column');
    } else {
      console.log('✓ Column edited_content already exists');
    }

    console.log('✓ Added edited_content column to review_requests table');
    console.log('\n=== Migration completed successfully ===\n');

  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    if (connection) await connection.end();
  }
}

addEditedContentColumn();
