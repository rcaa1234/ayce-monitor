/**
 * 初始化智能排程系統
 * 用途：建立預設配置（時段 19:00-22:30，每天發 1 篇）
 * 執行：node scripts/setup-smart-scheduling.js
 */
const mysql = require('mysql2/promise');
const crypto = require('crypto');
require('dotenv').config({ path: '.env.local' });

/**
 * 生成 UUID
 * @returns {string} UUID 字串
 */
function generateUUID() {
  return crypto.randomUUID();
}

async function setup() {
  console.log('🚀 初始化智能排程系統\n');

  const conn = await mysql.createConnection({
    host: process.env.MYSQL_HOST || 'localhost',
    user: 'root',
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
  });

  try {
    // 1. 建立預設時段配置
    console.log('📅 建立發文時段配置 (19:00-22:30)...');

    const [existingConfig] = await conn.execute(
      'SELECT id FROM posting_schedule_config WHERE enabled = true LIMIT 1'
    );

    if (existingConfig.length === 0) {
      const configId = generateUUID();
      await conn.execute(`
        INSERT INTO posting_schedule_config (
          id, start_hour, start_minute, end_hour, end_minute,
          posts_per_day, active_days, exploration_rate, enabled
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        configId,
        19, 0,      // 開始時間 19:00
        22, 30,     // 結束時間 22:30
        1,          // 每天 1 篇
        JSON.stringify([0,1,2,3,4,5,6]),  // 每天都發（0=日, 1=一, ..., 6=六）
        0.20,       // 20% 探索率（方案 A 暫不使用）
        true        // 啟用
      ]);
      console.log(`✓ 配置已建立 (ID: ${configId})\n`);
    } else {
      console.log('✓ 配置已存在，跳過建立\n');
    }

    // 2. 建立範例模板（您可以之後修改）
    console.log('📝 建立範例內容模板...');

    const templates = [
      {
        name: '範例模板-知識型',
        prompt: '分享一個實用的生活小知識或技巧，用簡單易懂的方式說明，讓讀者能立即應用。',
        description: '適合分享實用資訊、小技巧、知識點'
      },
      {
        name: '範例模板-娛樂型',
        prompt: '寫一個輕鬆有趣的小故事或幽默段子，讓讀者會心一笑。',
        description: '適合娛樂性內容、搞笑段子、輕鬆話題'
      },
      {
        name: '範例模板-共鳴型',
        prompt: '寫一段能引發讀者情感共鳴的文字，關於日常生活中的小確幸或感悟。',
        description: '適合情感類內容、生活感悟、溫暖文字'
      }
    ];

    let createdCount = 0;
    let existingCount = 0;

    for (const tmpl of templates) {
      const [existing] = await conn.execute(
        'SELECT id FROM content_templates WHERE name = ?',
        [tmpl.name]
      );

      if (existing.length === 0) {
        const id = generateUUID();
        await conn.execute(`
          INSERT INTO content_templates (id, name, prompt, description, enabled)
          VALUES (?, ?, ?, ?, ?)
        `, [id, tmpl.name, tmpl.prompt, tmpl.description, true]);
        console.log(`  ✓ 建立: ${tmpl.name}`);
        createdCount++;
      } else {
        console.log(`  - 已存在: ${tmpl.name}`);
        existingCount++;
      }
    }

    console.log(`\n總計: ${createdCount} 個新建立, ${existingCount} 個已存在\n`);

    // 3. 顯示當前配置
    console.log('━'.repeat(70));
    console.log('📊 當前配置總覽:\n');

    const [configs] = await conn.execute(`
      SELECT * FROM posting_schedule_config WHERE enabled = true LIMIT 1
    `);

    if (configs.length > 0) {
      const cfg = configs[0];
      // 修正：MySQL 返回的 JSON 欄位可能是字串或物件
      const activeDays = typeof cfg.active_days === 'string'
        ? JSON.parse(cfg.active_days)
        : cfg.active_days;
      const dayNames = ['日', '一', '二', '三', '四', '五', '六'];
      const activeWeekdays = activeDays.map(d => dayNames[d]).join(', ');

      console.log('發文時段:');
      console.log(`  ${String(cfg.start_hour).padStart(2, '0')}:${String(cfg.start_minute).padStart(2, '0')} - ${String(cfg.end_hour).padStart(2, '0')}:${String(cfg.end_minute).padStart(2, '0')}`);
      console.log(`\n發文頻率: 每天 ${cfg.posts_per_day} 篇`);
      console.log(`\n啟用星期: ${activeWeekdays}`);
    }

    const [templates_list] = await conn.execute(`
      SELECT name, enabled, total_uses, avg_engagement_rate
      FROM content_templates
      ORDER BY name
    `);

    console.log(`\n內容模板: (共 ${templates_list.length} 個)`);
    templates_list.forEach(t => {
      const status = t.enabled ? '✓' : '✗';
      const uses = t.total_uses || 0;
      const engagement = t.avg_engagement_rate || 0;
      console.log(`  ${status} ${t.name}`);
      console.log(`     使用次數: ${uses} | 平均互動率: ${engagement}%`);
    });

    console.log('\n━'.repeat(70));
    console.log('\n✅ 初始化完成！\n');

    console.log('📖 下一步:\n');
    console.log('1. 修改模板（可選）:');
    console.log('   直接編輯資料庫 content_templates 表');
    console.log('   或使用 SQL:');
    console.log('   UPDATE content_templates SET name="您的名稱", prompt="您的提示詞" WHERE id="...";');
    console.log('');
    console.log('2. 手動建立今天的排程:');
    console.log('   使用 scripts/create-daily-schedule.js');
    console.log('');
    console.log('3. 查看分析報告:');
    console.log('   node scripts/analyze-best-posting-times.js');
    console.log('');

  } finally {
    await conn.end();
  }
}

setup().catch(console.error);
