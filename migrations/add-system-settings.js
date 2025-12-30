const mysql = require('mysql2/promise');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');

// Load .env.local
const envPath = path.resolve(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

async function addSystemSettings() {
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

    // Create system_settings table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS system_settings (
        id CHAR(36) PRIMARY KEY,
        setting_key VARCHAR(100) NOT NULL UNIQUE,
        setting_value TEXT,
        setting_type ENUM('STRING', 'NUMBER', 'BOOLEAN', 'JSON') DEFAULT 'STRING',
        description TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_setting_key (setting_key)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);

    console.log('✓ Created system_settings table');

    // Insert default settings
    const { v4: uuid } = require('uuid');

    const defaultSettings = [
      {
        id: uuid(),
        key: 'ai_engine',
        value: 'GPT4',
        type: 'STRING',
        description: 'AI引擎選擇: GPT4 或 GEMINI'
      },
      {
        id: uuid(),
        key: 'style_preset',
        value: 'professional',
        type: 'STRING',
        description: '發文風格預設值'
      },
      {
        id: uuid(),
        key: 'custom_prompt',
        value: '請以專業、友善的語氣撰寫關於科技趨勢的文章',
        type: 'STRING',
        description: '自訂提示詞'
      },
      {
        id: uuid(),
        key: 'schedule_config',
        value: JSON.stringify({
          monday: { enabled: true, time: '09:00' },
          tuesday: { enabled: true, time: '09:00' },
          wednesday: { enabled: true, time: '09:00' },
          thursday: { enabled: true, time: '09:00' },
          friday: { enabled: true, time: '09:00' },
          saturday: { enabled: false, time: '09:00' },
          sunday: { enabled: false, time: '09:00' }
        }),
        type: 'JSON',
        description: '每週排程設定'
      },
      {
        id: uuid(),
        key: 'timezone',
        value: 'Asia/Taipei',
        type: 'STRING',
        description: '時區設定'
      },
      {
        id: uuid(),
        key: 'test_generation_count',
        value: '3',
        type: 'NUMBER',
        description: '測試生成文章數量'
      }
    ];

    for (const setting of defaultSettings) {
      await connection.execute(
        `INSERT INTO system_settings (id, setting_key, setting_value, setting_type, description)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
        [setting.id, setting.key, setting.value, setting.type, setting.description]
      );
    }

    console.log('✓ Inserted default settings');
    console.log('\n=== Migration completed successfully ===\n');

  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    if (connection) await connection.end();
  }
}

addSystemSettings();
