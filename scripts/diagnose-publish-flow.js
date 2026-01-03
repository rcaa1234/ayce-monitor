/**
 * 診斷發布流程
 * 檢查從 LINE 審核到 Threads 發布的完整流程
 */

const mysql = require('mysql2/promise');

const dbConfig = {
  host: process.env.MYSQL_HOST || 'localhost',
  port: parseInt(process.env.MYSQL_PORT || '3306', 10),
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD || '',
  database: process.env.MYSQL_DATABASE || 'threads_bot_db',
};

async function diagnosePubishFlow() {
  let connection;

  try {
    console.log('═'.repeat(70));
    console.log('診斷發布流程');
    console.log('═'.repeat(70));

    connection = await mysql.createConnection(dbConfig);
    console.log('✓ 資料庫連接成功\n');

    // 1. 檢查 Threads 帳號
    console.log('【1】檢查 Threads 帳號');
    console.log('─'.repeat(70));
    const [accounts] = await connection.execute(
      `SELECT ta.id, ta.user_id, ta.username, ta.account_id, ta.status, ta.is_default,
              t.expires_at, t.status as token_status
       FROM threads_accounts ta
       LEFT JOIN threads_auth t ON ta.id = t.account_id
       ORDER BY ta.is_default DESC, ta.created_at DESC
       LIMIT 3`
    );

    if (accounts.length === 0) {
      console.log('❌ 找不到任何 Threads 帳號!');
      console.log('   請先進行 Threads OAuth 授權\n');
      return;
    }

    for (const acc of accounts) {
      console.log(`帳號 ID: ${acc.id}`);
      console.log(`使用者 ID: ${acc.user_id || '(空)'}`);
      console.log(`使用者名稱: ${acc.username}`);
      console.log(`Threads Account ID: ${acc.account_id || '❌ (空 - 這會導致發布失敗!)'}`);
      console.log(`帳號狀態: ${acc.status}`);
      console.log(`預設帳號: ${acc.is_default ? '✓ 是' : '否'}`);
      console.log(`Token 狀態: ${acc.token_status || '無'}`);
      console.log(`Token 過期時間: ${acc.expires_at || '無'}`);

      if (!acc.account_id) {
        console.log('⚠️  缺少 account_id - 發布會失敗!');
      } else if (!acc.is_default) {
        console.log('⚠️  不是預設帳號 - 可能不會被使用');
      } else if (acc.token_status !== 'OK') {
        console.log('⚠️  Token 狀態異常');
      } else if (new Date(acc.expires_at) < new Date()) {
        console.log('⚠️  Token 已過期');
      } else {
        console.log('✓ 帳號設定正常');
      }
      console.log('');
    }

    // 2. 檢查最近的文章狀態
    console.log('\n【2】檢查最近的文章');
    console.log('─'.repeat(70));
    const [posts] = await connection.execute(
      `SELECT p.id, p.status, p.created_at, p.approved_at, p.posted_at,
              p.post_url, p.threads_media_id,
              p.last_error_code, p.last_error_message,
              pr.content
       FROM posts p
       LEFT JOIN post_revisions pr ON p.id = pr.post_id AND pr.revision_no = (
         SELECT MAX(revision_no) FROM post_revisions WHERE post_id = p.id
       )
       ORDER BY p.created_at DESC
       LIMIT 5`
    );

    if (posts.length === 0) {
      console.log('沒有找到任何文章\n');
    } else {
      for (let i = 0; i < posts.length; i++) {
        const post = posts[i];
        console.log(`[${i + 1}] 文章 ID: ${post.id}`);
        console.log(`    狀態: ${post.status}`);
        console.log(`    建立時間: ${post.created_at}`);
        console.log(`    核准時間: ${post.approved_at || '(未核准)'}`);
        console.log(`    發布時間: ${post.posted_at || '(未發布)'}`);
        console.log(`    文章網址: ${post.post_url || '(無)'}`);
        console.log(`    Threads Media ID: ${post.threads_media_id || '(無)'}`);

        if (post.last_error_code || post.last_error_message) {
          console.log(`    ❌ 錯誤代碼: ${post.last_error_code || '無'}`);
          console.log(`    ❌ 錯誤訊息: ${post.last_error_message || '無'}`);
        }

        if (post.content) {
          const preview = post.content.substring(0, 50).replace(/\n/g, ' ');
          console.log(`    內容預覽: ${preview}...`);
        }

        // 分析狀態
        if (post.status === 'APPROVED' && !post.posted_at) {
          console.log(`    ⚠️  已核准但未發布 - Worker 可能沒有執行!`);
        } else if (post.status === 'FAILED') {
          console.log(`    ❌ 發布失敗`);
        } else if (post.status === 'POSTED') {
          console.log(`    ✓ 已成功發布`);
        }

        console.log('');
      }
    }

    // 3. 檢查 Redis 連接 (BullMQ 佇列)
    console.log('\n【3】檢查 Redis 和佇列狀態');
    console.log('─'.repeat(70));
    console.log('Redis URL:', process.env.REDIS_URL || '(未設定 REDIS_URL)');
    console.log('');

    // 4. 檢查最近的審核請求
    console.log('【4】檢查最近的審核請求');
    console.log('─'.repeat(70));
    const [reviews] = await connection.execute(
      `SELECT rr.id, rr.post_id, rr.status, rr.created_at, rr.used_at,
              p.status as post_status
       FROM review_requests rr
       LEFT JOIN posts p ON rr.post_id = p.id
       ORDER BY rr.created_at DESC
       LIMIT 5`
    );

    if (reviews.length === 0) {
      console.log('沒有找到任何審核請求\n');
    } else {
      for (let i = 0; i < reviews.length; i++) {
        const review = reviews[i];
        console.log(`[${i + 1}] 審核請求 ID: ${review.id}`);
        console.log(`    文章 ID: ${review.post_id}`);
        console.log(`    審核狀態: ${review.status}`);
        console.log(`    建立時間: ${review.created_at}`);
        console.log(`    使用時間: ${review.used_at || '(未使用)'}`);
        console.log(`    文章狀態: ${review.post_status}`);

        if (review.status === 'USED' && review.post_status === 'APPROVED') {
          console.log(`    ⚠️  已核准但文章仍在 APPROVED 狀態 - 發布可能失敗`);
        }

        console.log('');
      }
    }

    // 5. 給出建議
    console.log('═'.repeat(70));
    console.log('【診斷結果與建議】');
    console.log('═'.repeat(70));

    const defaultAccount = accounts.find(a => a.is_default);

    if (!defaultAccount) {
      console.log('❌ 找不到預設 Threads 帳號');
      console.log('   建議: 重新進行 OAuth 授權');
    } else if (!defaultAccount.account_id) {
      console.log('❌ 預設帳號缺少 account_id');
      console.log('   建議: 需要手動更新資料庫或重新授權');
      console.log(`   SQL: UPDATE threads_accounts SET account_id = 'YOUR_THREADS_USER_ID' WHERE id = '${defaultAccount.id}';`);
    } else if (defaultAccount.token_status !== 'OK') {
      console.log('❌ Token 狀態異常');
      console.log('   建議: 重新整理 Token 或重新授權');
    } else {
      console.log('✓ Threads 帳號設定正常');
    }

    const approvedButNotPosted = posts.filter(p => p.status === 'APPROVED' && !p.posted_at);
    if (approvedButNotPosted.length > 0) {
      console.log('\n⚠️  發現已核准但未發布的文章');
      console.log('   可能原因:');
      console.log('   1. Worker 服務沒有在執行');
      console.log('   2. Redis 連接失敗,無法處理佇列');
      console.log('   3. Threads API 呼叫失敗');
      console.log('\n   建議: 檢查 Zeabur Worker 服務的日誌');
    }

    const failedPosts = posts.filter(p => p.status === 'FAILED');
    if (failedPosts.length > 0) {
      console.log('\n❌ 發現發布失敗的文章');
      console.log('   請查看上方的錯誤訊息來了解失敗原因');
    }

    console.log('═'.repeat(70));

  } catch (error) {
    console.error('✗ 發生錯誤:', error.message);
    throw error;
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

if (require.main === module) {
  diagnosePubishFlow()
    .then(() => {
      console.log('\n診斷完成');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n診斷失敗:', error);
      process.exit(1);
    });
}

module.exports = { diagnosePubishFlow };
