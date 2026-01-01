/**
 * 分析最佳發文時段
 * 基於現有數據，找出每個時段的平均表現
 */
const mysql = require('mysql2/promise');
const CryptoJS = require('crypto-js');

require('dotenv').config({ path: '.env.local' });

async function analyzeBestTimes() {
  console.log('📊 分析最佳發文時段\n');

  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST || 'localhost',
    user: 'root',
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
  });

  try {
    // 查詢所有已發布貼文的時段和表現
    const [posts] = await connection.execute(`
      SELECT
        p.id,
        p.posted_at,
        HOUR(p.posted_at) as post_hour,
        DAYOFWEEK(p.posted_at) as day_of_week,
        pi.views,
        pi.likes,
        pi.replies,
        pi.reposts,
        pi.shares,
        pi.engagement_rate,
        pr.content
      FROM posts p
      LEFT JOIN post_insights pi ON p.id = pi.post_id
      LEFT JOIN post_revisions pr ON p.id = pr.post_id
      WHERE p.status = 'POSTED'
        AND p.posted_at IS NOT NULL
      ORDER BY p.posted_at DESC
    `);

    if (posts.length === 0) {
      console.log('⚠️  沒有足夠的數據進行分析');
      console.log('   請至少發布 10 篇貼文並等待 Insights 數據同步\n');
      return;
    }

    console.log(`✓ 找到 ${posts.length} 篇已發布貼文\n`);
    console.log('━'.repeat(80));

    // 按小時統計
    const hourlyStats = {};
    for (let hour = 0; hour < 24; hour++) {
      hourlyStats[hour] = {
        count: 0,
        totalViews: 0,
        totalLikes: 0,
        totalEngagement: 0,
        avgEngagementRate: 0,
        posts: []
      };
    }

    // 聚合數據
    posts.forEach(post => {
      const hour = post.post_hour;
      if (!post.views) return; // 跳過沒有 insights 的

      hourlyStats[hour].count++;
      hourlyStats[hour].totalViews += post.views;
      hourlyStats[hour].totalLikes += post.likes;
      hourlyStats[hour].totalEngagement += (post.likes + post.replies + post.reposts + post.shares);
      hourlyStats[hour].posts.push(post);
    });

    // 計算平均值
    Object.keys(hourlyStats).forEach(hour => {
      const stats = hourlyStats[hour];
      if (stats.count > 0) {
        stats.avgViews = (stats.totalViews / stats.count).toFixed(1);
        stats.avgLikes = (stats.totalLikes / stats.count).toFixed(1);
        stats.avgEngagement = (stats.totalEngagement / stats.count).toFixed(1);
        stats.avgEngagementRate = (
          stats.posts.reduce((sum, p) => sum + p.engagement_rate, 0) / stats.posts.length
        ).toFixed(2);
      }
    });

    // 找出最佳時段（至少 2 次數據）
    const significantHours = Object.entries(hourlyStats)
      .filter(([_, stats]) => stats.count >= 2)
      .sort((a, b) => parseFloat(b[1].avgEngagementRate) - parseFloat(a[1].avgEngagementRate));

    console.log('\n📈 時段表現排行（至少2篇貼文）:\n');
    console.log('排名 | 時段     | 發文數 | 平均瀏覽 | 平均按讚 | 平均互動率');
    console.log('━'.repeat(80));

    significantHours.slice(0, 10).forEach(([hour, stats], index) => {
      const timeStr = `${hour.toString().padStart(2, '0')}:00`;
      const rank = (index + 1).toString().padStart(2, ' ');
      const count = stats.count.toString().padStart(3, ' ');
      const views = stats.avgViews.toString().padStart(6, ' ');
      const likes = stats.avgLikes.toString().padStart(6, ' ');
      const engagement = `${stats.avgEngagementRate}%`;

      // 表現等級
      let level = '⭐';
      if (stats.avgEngagementRate > 10) level = '⭐⭐⭐⭐⭐';
      else if (stats.avgEngagementRate > 7) level = '⭐⭐⭐⭐';
      else if (stats.avgEngagementRate > 5) level = '⭐⭐⭐';
      else if (stats.avgEngagementRate > 3) level = '⭐⭐';

      console.log(`  ${rank} | ${timeStr}   |  ${count}   | ${views}   | ${likes}   | ${engagement.padEnd(7)} ${level}`);
    });

    // 按星期分析
    console.log('\n━'.repeat(80));
    console.log('\n📅 星期表現分析:\n');

    const dayNames = ['日', '一', '二', '三', '四', '五', '六'];
    const weeklyStats = {};
    for (let day = 1; day <= 7; day++) {
      weeklyStats[day] = {
        count: 0,
        totalEngagement: 0,
        posts: []
      };
    }

    posts.forEach(post => {
      if (!post.views) return;
      const day = post.day_of_week;
      weeklyStats[day].count++;
      weeklyStats[day].posts.push(post);
    });

    Object.keys(weeklyStats).forEach(day => {
      const stats = weeklyStats[day];
      if (stats.count > 0) {
        stats.avgEngagementRate = (
          stats.posts.reduce((sum, p) => sum + p.engagement_rate, 0) / stats.posts.length
        ).toFixed(2);
      }
    });

    console.log('星期 | 發文數 | 平均互動率');
    console.log('━'.repeat(40));
    Object.entries(weeklyStats)
      .sort((a, b) => parseFloat(b[1].avgEngagementRate || 0) - parseFloat(a[1].avgEngagementRate || 0))
      .forEach(([day, stats]) => {
        if (stats.count === 0) return;
        const dayName = `星期${dayNames[day - 1]}`;
        const count = stats.count.toString().padStart(3, ' ');
        const engagement = `${stats.avgEngagementRate || 0}%`;
        console.log(`${dayName}  |  ${count}   | ${engagement}`);
      });

    // 建議
    console.log('\n━'.repeat(80));
    console.log('\n💡 AI 建議:\n');

    if (significantHours.length >= 3) {
      const top3 = significantHours.slice(0, 3);
      console.log('🎯 最佳發文時段（基於現有數據）:');
      top3.forEach(([hour, stats], i) => {
        const timeStr = `${hour.toString().padStart(2, '0')}:00`;
        console.log(`   ${i + 1}. ${timeStr} - 平均互動率 ${stats.avgEngagementRate}% (${stats.count} 篇貼文)`);
      });

      console.log('\n📝 建議:');
      console.log(`   - 重點在 ${top3.map(([h]) => `${h}:00`).join(', ')} 發文`);
      console.log(`   - 繼續在其他時段嘗試，收集更多數據`);
      console.log(`   - 至少每個時段發 5 篇以上才有統計意義`);
    } else {
      console.log('⚠️  數據量不足，建議:');
      console.log('   1. 繼續發文至少 2 週');
      console.log('   2. 嘗試不同時段（早、中、晚）');
      console.log('   3. 每個時段至少發 5 篇貼文');
      console.log('   4. 確保 Insights 數據有同步');
    }

    // 數據缺口分析
    const hoursWithData = Object.entries(hourlyStats)
      .filter(([_, stats]) => stats.count > 0)
      .map(([hour]) => parseInt(hour));

    const hoursWithoutData = [];
    for (let hour = 6; hour <= 23; hour++) {
      if (!hoursWithData.includes(hour)) {
        hoursWithoutData.push(hour);
      }
    }

    if (hoursWithoutData.length > 0) {
      console.log('\n🔍 尚未嘗試的時段:');
      console.log('   ' + hoursWithoutData.map(h => `${h}:00`).join(', '));
      console.log('   建議嘗試這些時段以收集完整數據');
    }

    console.log('\n━'.repeat(80));
    console.log('\n✅ 分析完成！');
    console.log('\n💾 下一步:');
    console.log('   - 定期執行此分析（每週一次）');
    console.log('   - 根據建議調整發文時間');
    console.log('   - 持續追蹤互動率變化\n');

  } catch (error) {
    console.error('❌ 錯誤:', error.message);
  } finally {
    await connection.end();
  }
}

analyzeBestTimes();
