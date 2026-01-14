/**
 * 診斷自動發文排程
 */

const mysql = require('mysql2/promise');
require('dotenv').config({ path: '.env.local' });

async function diagnose() {
    const pool = await mysql.createPool({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        port: parseInt(process.env.DB_PORT || '3306'),
        ssl: { rejectUnauthorized: false },
    });

    console.log('===== 自動發文診斷 =====\n');

    // 1. 檢查 smart_schedule_config
    const [configs] = await pool.execute(
        'SELECT * FROM smart_schedule_config WHERE enabled = true LIMIT 1'
    );

    if (configs.length === 0) {
        console.log('❌ 沒有啟用的配置記錄');
        console.log('   → 請到「帳號管理」頁面設定 UCB 帳號\n');
    } else {
        const config = configs[0];
        console.log('📋 目前配置:');
        console.log(`   - auto_schedule_enabled: ${config.auto_schedule_enabled ? '✅ 啟用' : '❌ 停用'}`);
        console.log(`   - ai_prompt: ${config.ai_prompt ? '✅ 已設定 (' + config.ai_prompt.substring(0, 50) + '...)' : '❌ 未設定'}`);
        console.log(`   - ai_engine: ${config.ai_engine || 'GPT5_2'}`);
        console.log(`   - threads_account_id: ${config.threads_account_id || '❌ 未設定'}`);
        console.log(`   - line_user_id: ${config.line_user_id || '❌ 未設定'}`);
        console.log(`   - active_days: ${config.active_days || '[]'}`);
        console.log(`   - time_range: ${config.time_range_start || '09:00'} - ${config.time_range_end || '21:00'}`);
        console.log();

        // 檢查關鍵條件
        const issues = [];
        if (!config.auto_schedule_enabled) {
            issues.push('自動排程未啟用');
        }
        if (!config.ai_prompt || config.ai_prompt.trim() === '') {
            issues.push('AI 提示詞未設定（請到「提示詞設定」頁面設定）');
        }
        if (!config.threads_account_id) {
            issues.push('Threads 帳號未設定（請到「帳號管理」頁面設定）');
        }
        if (!config.line_user_id) {
            issues.push('LINE User ID 未設定（無法發送審核通知）');
        }

        // 檢查今天是否是 active_days
        const today = new Date();
        const dayOfWeek = today.getDay() === 0 ? 7 : today.getDay();
        const activeDays = config.active_days ?
            (typeof config.active_days === 'string' ? JSON.parse(config.active_days) : config.active_days) : [];

        if (activeDays.length > 0 && !activeDays.includes(dayOfWeek)) {
            issues.push(`今天是星期${dayOfWeek === 1 ? '一' : dayOfWeek === 2 ? '二' : dayOfWeek === 3 ? '三' : dayOfWeek === 4 ? '四' : dayOfWeek === 5 ? '五' : dayOfWeek === 6 ? '六' : '日'}(${dayOfWeek})，不在 active_days [${activeDays.join(',')}] 中`);
        }

        if (issues.length > 0) {
            console.log('⚠️ 發現問題:');
            issues.forEach((issue, i) => {
                console.log(`   ${i + 1}. ${issue}`);
            });
            console.log();
        } else {
            console.log('✅ 配置看起來正常\n');
        }
    }

    // 2. 檢查今天的排程
    const todayStr = new Date().toISOString().split('T')[0];
    const [schedules] = await pool.execute(
        'SELECT * FROM daily_auto_schedule WHERE schedule_date = ? ORDER BY created_at DESC',
        [todayStr]
    );

    console.log(`📅 今天(${todayStr})的排程:`);
    if (schedules.length === 0) {
        console.log('   沒有排程記錄\n');
    } else {
        schedules.forEach(s => {
            console.log(`   - ID: ${s.id}`);
            console.log(`     狀態: ${s.status}`);
            console.log(`     排程時間: ${s.scheduled_time}`);
            console.log(`     Post ID: ${s.post_id || '無'}`);
            console.log(`     錯誤: ${s.error_message || '無'}`);
            console.log();
        });
    }

    // 3. 檢查最近的 posts
    const [recentPosts] = await pool.execute(
        `SELECT p.id, p.status, p.created_at, p.is_ai_generated, 
            das.id as schedule_id, das.status as schedule_status
     FROM posts p
     LEFT JOIN daily_auto_schedule das ON p.id = das.post_id
     WHERE p.is_ai_generated = true
     ORDER BY p.created_at DESC
     LIMIT 5`
    );

    console.log('🤖 最近的 AI 生成貼文:');
    if (recentPosts.length === 0) {
        console.log('   沒有 AI 生成的貼文\n');
    } else {
        recentPosts.forEach(p => {
            console.log(`   - Post ${p.id}: ${p.status} (${p.created_at})`);
            if (p.schedule_id) {
                console.log(`     排程: ${p.schedule_id} [${p.schedule_status}]`);
            }
        });
        console.log();
    }

    await pool.end();
}

diagnose().catch(console.error);
