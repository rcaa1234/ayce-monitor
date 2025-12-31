/**
 * 為現有貼文補充 threads_media_id
 * 從 Threads API 獲取正確的 Media IDs 並更新資料庫
 */
const mysql = require('mysql2/promise');
const axios = require('axios');
const CryptoJS = require('crypto-js');

require('dotenv').config({ path: '.env.local' });

async function backfillMediaIds() {
  console.log('🔄 開始為現有貼文補充 threads_media_id...\n');

  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST || 'localhost',
    port: process.env.MYSQL_PORT || 3306,
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
  });

  try {
    // 1. 獲取 Access Token
    const [authRows] = await connection.execute(`
      SELECT t.access_token, ta.account_id
      FROM threads_auth t
      JOIN threads_accounts ta ON t.account_id = ta.id
      WHERE ta.status = 'ACTIVE'
      ORDER BY t.created_at DESC
      LIMIT 1
    `);

    if (authRows.length === 0) {
      console.log('❌ 找不到 Threads 帳號');
      return;
    }

    const bytes = CryptoJS.AES.decrypt(authRows[0].access_token, process.env.ENCRYPTION_KEY);
    const accessToken = bytes.toString(CryptoJS.enc.Utf8);
    const userId = authRows[0].account_id;

    console.log(`✓ 已取得 Access Token (User ID: ${userId})\n`);

    // 2. 從 Threads API 獲取所有 Media IDs
    console.log('📡 從 Threads API 獲取貼文列表...');
    const response = await axios.get(
      `https://graph.threads.net/v1.0/${userId}/threads`,
      {
        params: {
          fields: 'id,permalink',
          limit: 100,  // 最多 100 篇
          access_token: accessToken,
        },
      }
    );

    const threadsMedia = response.data.data;
    console.log(`✓ 獲取到 ${threadsMedia.length} 篇貼文\n`);

    // 建立 URL -> Media ID 的對應表
    const urlToMediaId = {};
    threadsMedia.forEach(media => {
      urlToMediaId[media.permalink] = media.id;
    });

    // 3. 查詢資料庫中缺少 threads_media_id 的貼文
    const [posts] = await connection.execute(`
      SELECT id, post_url
      FROM posts
      WHERE status = 'POSTED'
        AND post_url IS NOT NULL
        AND (threads_media_id IS NULL OR threads_media_id = '')
      ORDER BY posted_at DESC
    `);

    console.log(`📋 找到 ${posts.length} 篇貼文需要更新\n`);
    console.log('━'.repeat(80));

    if (posts.length === 0) {
      console.log('✅ 所有貼文都已有 threads_media_id，無需更新');
      return;
    }

    // 4. 更新每篇貼文的 threads_media_id
    let updatedCount = 0;
    let notFoundCount = 0;

    for (const post of posts) {
      const postUrl = post.post_url;
      const mediaId = urlToMediaId[postUrl];

      if (mediaId) {
        await connection.execute(
          'UPDATE posts SET threads_media_id = ? WHERE id = ?',
          [mediaId, post.id]
        );
        console.log(`✓ ${post.id.substring(0, 8)}... → ${mediaId}`);
        updatedCount++;
      } else {
        console.log(`⚠ ${post.id.substring(0, 8)}... → 找不到對應的 Media ID`);
        console.log(`  URL: ${postUrl}`);
        notFoundCount++;
      }
    }

    console.log('━'.repeat(80));
    console.log(`\n✅ 更新完成！`);
    console.log(`   成功: ${updatedCount} 篇`);
    console.log(`   失敗: ${notFoundCount} 篇\n`);

    // 5. 顯示更新後的結果
    const [updatedPosts] = await connection.execute(`
      SELECT id, post_url, threads_media_id
      FROM posts
      WHERE status = 'POSTED'
        AND threads_media_id IS NOT NULL
      ORDER BY posted_at DESC
      LIMIT 5
    `);

    console.log('📊 最近 5 篇貼文的 Media ID:');
    console.log('━'.repeat(80));
    updatedPosts.forEach((post, idx) => {
      console.log(`${idx + 1}. Media ID: ${post.threads_media_id}`);
      console.log(`   Post ID:  ${post.id}`);
      console.log(`   URL:      ${post.post_url}\n`);
    });

  } catch (error) {
    console.error('\n❌ 發生錯誤:', error.message);
    if (error.response) {
      console.error('API 錯誤:', JSON.stringify(error.response.data, null, 2));
    }
  } finally {
    await connection.end();
  }
}

backfillMediaIds();
