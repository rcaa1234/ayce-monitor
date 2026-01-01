/**
 * UCB 智能排程系統初始化腳本
 * 用途：建立範例模板、時段配置和系統配置
 * 執行：node scripts/init-ucb-system.js
 */

const mysql = require('mysql2/promise');
const { v4: uuidv4 } = require('uuid');

// 從環境變數讀取資料庫配置
require('dotenv').config({ path: '.env.local' });

const dbConfig = {
  host: process.env.MYSQL_HOST || 'localhost',
  port: parseInt(process.env.MYSQL_PORT || '3306'),
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD || '',
  database: process.env.MYSQL_DATABASE || 'threads_posting',
};

async function initUCBSystem() {
  let connection;

  try {
    console.log('🚀 正在初始化 UCB 智能排程系統...\n');

    connection = await mysql.createConnection(dbConfig);

    // 1. 建立範例內容模板
    console.log('📝 建立範例內容模板...');

    const templates = [
      {
        id: uuidv4(),
        name: '知識分享型',
        prompt: `請產生一篇 Threads 貼文，內容為實用的知識分享。
要求：
1. 分享一個實用的技巧或知識
2. 用簡單易懂的方式說明
3. 加入具體例子
4. 字數控制在 150-200 字
5. 語氣親切自然
6. 不使用 emoji（除非特別需要）`,
        description: '分享實用知識和技巧',
      },
      {
        id: uuidv4(),
        name: '生活觀察型',
        prompt: `請產生一篇 Threads 貼文，內容為生活中的有趣觀察。
要求：
1. 描述一個日常生活中的有趣現象
2. 引起讀者共鳴
3. 可以加入小小的幽默感
4. 字數控制在 120-180 字
5. 語氣輕鬆自然
6. 結尾可以問讀者「你有過類似經驗嗎？」`,
        description: '分享生活中的有趣觀察和體驗',
      },
      {
        id: uuidv4(),
        name: '勵志啟發型',
        prompt: `請產生一篇 Threads 貼文，內容為正向激勵的短文。
要求：
1. 分享一個正向的想法或啟發
2. 鼓勵讀者採取行動或改變思維
3. 避免陳腔濫調
4. 字數控制在 100-150 字
5. 語氣溫暖有力
6. 結尾給出具體建議`,
        description: '正向激勵，啟發思考',
      },
    ];

    for (const template of templates) {
      const [existing] = await connection.execute('SELECT id FROM content_templates WHERE name = ?', [template.name]);

      if (existing.length > 0) {
        console.log(`  ⚠️  模板「${template.name}」已存在，跳過`);
      } else {
        await connection.execute(
          `INSERT INTO content_templates (id, name, prompt, description, enabled)
           VALUES (?, ?, ?, ?, true)`,
          [template.id, template.name, template.prompt, template.description]
        );
        console.log(`  ✓ 已建立模板：${template.name}`);
      }
    }

    // 2. 建立時段配置
    console.log('\n⏰ 建立時段配置...');

    // 先取得所有模板 ID
    const [allTemplates] = await connection.execute('SELECT id FROM content_templates WHERE enabled = true');
    const templateIds = allTemplates.map((t) => t.id);

    const timeSlots = [
      {
        id: uuidv4(),
        name: '晚間黃金時段',
        start_hour: 19,
        start_minute: 0,
        end_hour: 22,
        end_minute: 30,
        allowed_template_ids: templateIds, // 允許所有模板
        active_days: [1, 2, 3, 4, 5, 6, 7], // 每天
        priority: 100,
      },
      {
        id: uuidv4(),
        name: '午後時光',
        start_hour: 14,
        start_minute: 0,
        end_hour: 17,
        end_minute: 0,
        allowed_template_ids: templateIds,
        active_days: [1, 2, 3, 4, 5], // 週一到週五
        priority: 50,
      },
    ];

    for (const slot of timeSlots) {
      const [existing] = await connection.execute('SELECT id FROM schedule_time_slots WHERE name = ?', [slot.name]);

      if (existing.length > 0) {
        console.log(`  ⚠️  時段「${slot.name}」已存在，跳過`);
      } else {
        await connection.execute(
          `INSERT INTO schedule_time_slots
           (id, name, start_hour, start_minute, end_hour, end_minute,
            allowed_template_ids, active_days, enabled, priority)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, true, ?)`,
          [
            slot.id,
            slot.name,
            slot.start_hour,
            slot.start_minute,
            slot.end_hour,
            slot.end_minute,
            JSON.stringify(slot.allowed_template_ids),
            JSON.stringify(slot.active_days),
            slot.priority,
          ]
        );
        console.log(`  ✓ 已建立時段：${slot.name} (${slot.start_hour}:${String(slot.start_minute).padStart(2, '0')}-${slot.end_hour}:${String(slot.end_minute).padStart(2, '0')})`);
      }
    }

    // 3. 建立 UCB 系統配置
    console.log('\n⚙️  建立 UCB 系統配置...');

    const [existingConfig] = await connection.execute('SELECT id FROM smart_schedule_config WHERE enabled = true LIMIT 1');

    if (existingConfig.length > 0) {
      console.log('  ⚠️  UCB 配置已存在，跳過');
    } else {
      const configId = uuidv4();
      await connection.execute(
        `INSERT INTO smart_schedule_config
         (id, exploration_factor, min_trials_per_template, posts_per_day, auto_schedule_enabled, enabled)
         VALUES (?, ?, ?, ?, ?, true)`,
        [
          configId,
          1.5, // exploration_factor
          5, // min_trials_per_template
          1, // posts_per_day
          true, // auto_schedule_enabled
        ]
      );
      console.log('  ✓ 已建立 UCB 配置');
      console.log('    - 探索係數: 1.5');
      console.log('    - 最少試驗次數: 5');
      console.log('    - 每天發文數: 1');
      console.log('    - 自動排程: 啟用');
    }

    console.log('\n✅ UCB 智能排程系統初始化完成！\n');
    console.log('📋 已建立項目：');
    console.log(`   - ${templates.length} 個內容模板`);
    console.log(`   - ${timeSlots.length} 個時段配置`);
    console.log('   - 1 個系統配置');
    console.log('\n🎯 下一步：');
    console.log('   1. 訪問模板管理頁面 (待建立)');
    console.log('   2. 訪問智能排程配置頁面 (待建立)');
    console.log('   3. 系統將在每天 00:00 自動建立排程');
    console.log('   4. 或使用 API 手動觸發: POST /api/trigger-daily-schedule\n');
  } catch (error) {
    console.error('❌ 初始化失敗:', error);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

// 執行初始化
initUCBSystem()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  });
