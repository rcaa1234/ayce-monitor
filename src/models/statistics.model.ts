/**
 * Statistics Model
 * 提供統計數據的資料庫查詢方法
 *
 * 數據來源：所有已發布的貼文
 * - 基於 posts 表（status = 'POSTED'）
 * - LEFT JOIN post_insights 獲取互動數據
 */

import { getPool } from '../database/connection';
import { RowDataPacket } from 'mysql2';
import logger from '../utils/logger';

export interface OverviewStats {
  total_posts: number;
  total_views: number;
  total_likes: number;
  total_replies: number;
  avg_engagement_rate: number;
}

export interface TrendData {
  dates: string[];
  views: number[];
  engagement: number[];
}

export interface TimeslotStats {
  id: string;
  name: string;
  start_hour: number;
  start_minute: number;
  posts_count: number;
  avg_engagement_rate: number;
  avg_likes: number;
  avg_views: number;
}

export interface PostDetail {
  id: string;
  content_preview: string;
  posted_at: string;
  views: number;
  likes: number;
  replies: number;
  engagement_rate: number;
  media_type: string;
}

export class StatisticsModel {
  /**
   * 計算參與率
   */
  private static calculateEngagementRate(views: number, likes: number, replies: number, reposts: number = 0): number {
    if (views === 0) return 0;
    const totalEngagement = (likes || 0) + (replies || 0) + (reposts || 0);
    return (totalEngagement / views) * 100;
  }

  /**
   * 獲取統計總覽數據
   */
  static async getOverviewStats(days: number = 7): Promise<{
    overview: OverviewStats;
    trend: TrendData;
  }> {
    const pool = getPool();

    try {
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      // 1. 獲取總覽統計
      const [overviewRows] = await pool.execute<RowDataPacket[]>(
        `SELECT
          COUNT(DISTINCT p.id) as total_posts,
          COALESCE(SUM(pi.views), 0) as total_views,
          COALESCE(SUM(pi.likes), 0) as total_likes,
          COALESCE(SUM(pi.replies), 0) as total_replies,
          COALESCE(AVG(
            CASE
              WHEN pi.views > 0 THEN ((pi.likes + pi.replies + COALESCE(pi.reposts, 0)) / pi.views * 100)
              ELSE 0
            END
          ), 0) as avg_engagement_rate
        FROM posts p
        LEFT JOIN post_insights pi ON p.id = pi.post_id
        WHERE p.status = 'POSTED'
          AND p.posted_at >= ?
          AND p.posted_at <= ?`,
        [startDate, endDate]
      );

      const overview = overviewRows[0] as OverviewStats;

      // 2. 獲取趨勢數據（每日統計）
      const [trendRows] = await pool.execute<RowDataPacket[]>(
        `SELECT
          DATE(p.posted_at) as date,
          COALESCE(SUM(pi.views), 0) as views,
          COALESCE(AVG(
            CASE
              WHEN pi.views > 0 THEN ((pi.likes + pi.replies + COALESCE(pi.reposts, 0)) / pi.views * 100)
              ELSE 0
            END
          ), 0) as engagement_rate
        FROM posts p
        LEFT JOIN post_insights pi ON p.id = pi.post_id
        WHERE p.status = 'POSTED'
          AND p.posted_at >= ?
          AND p.posted_at <= ?
        GROUP BY DATE(p.posted_at)
        ORDER BY date ASC`,
        [startDate, endDate]
      );

      // 格式化趨勢數據
      const trend: TrendData = {
        dates: [],
        views: [],
        engagement: [],
      };

      // 填充所有日期（包含沒有數據的日期）
      for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().split('T')[0];
        const dataPoint = trendRows.find((row: any) => {
          const rowDate = new Date(row.date).toISOString().split('T')[0];
          return rowDate === dateStr;
        });

        trend.dates.push(dateStr);
        trend.views.push(dataPoint ? Number(dataPoint.views) : 0);
        trend.engagement.push(dataPoint ? Number(dataPoint.engagement_rate) : 0);
      }

      return { overview, trend };
    } catch (error) {
      logger.error('Failed to get overview stats:', error);
      throw error;
    }
  }

  /**
   * 獲取時段統計數據（按實際發文時間的小時分組）
   */
  static async getTimeslotStats(days: number = 3650): Promise<TimeslotStats[]> {
    const pool = getPool();

    try {
      // 使用子查詢方式確保 MySQL 兼容性
      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT 
          hour_of_day as id,
          CONCAT(LPAD(hour_of_day, 2, '0'), ':00 - ', LPAD(hour_of_day, 2, '0'), ':59') as name,
          hour_of_day as start_hour,
          0 as start_minute,
          post_count as posts_count,
          avg_rate as avg_engagement_rate,
          avg_like as avg_likes,
          avg_view as avg_views
        FROM (
          SELECT 
            HOUR(CONVERT_TZ(p.posted_at, '+00:00', '+08:00')) as hour_of_day,
            COUNT(*) as post_count,
            COALESCE(AVG(
              CASE 
                WHEN pi.views > 0 THEN ((COALESCE(pi.likes, 0) + COALESCE(pi.replies, 0) + COALESCE(pi.reposts, 0)) / pi.views * 100)
                ELSE 0 
              END
            ), 0) as avg_rate,
            COALESCE(AVG(COALESCE(pi.likes, 0)), 0) as avg_like,
            COALESCE(AVG(COALESCE(pi.views, 0)), 0) as avg_view
          FROM posts p
          LEFT JOIN post_insights pi ON p.id = pi.post_id
          WHERE p.status = 'POSTED' 
            AND p.posted_at IS NOT NULL
          GROUP BY HOUR(CONVERT_TZ(p.posted_at, '+00:00', '+08:00'))
        ) as hourly_stats
        WHERE post_count > 0
        ORDER BY hour_of_day ASC`
      );

      return rows as TimeslotStats[];
    } catch (error) {
      logger.error('Failed to get timeslot stats:', error);
      throw error;
    }
  }

  /**
   * 獲取貼文明細列表
   */
  static async getPostDetails(params: {
    page?: number;
    limit?: number;
    sortBy?: 'posted_at' | 'views' | 'engagement_rate';
    sortOrder?: 'ASC' | 'DESC';
    dateFrom?: Date;
    dateTo?: Date;
  }): Promise<{
    posts: PostDetail[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    const pool = getPool();

    try {
      const page = params.page || 1;
      const limit = params.limit || 20;
      const offset = (page - 1) * limit;
      const sortBy = params.sortBy || 'posted_at';
      const sortOrder = params.sortOrder || 'DESC';

      // 構建 WHERE 條件
      const conditions: string[] = ["p.status = 'POSTED'"];
      const queryParams: any[] = [];

      if (params.dateFrom) {
        conditions.push('p.posted_at >= ?');
        queryParams.push(params.dateFrom);
      }

      if (params.dateTo) {
        conditions.push('p.posted_at <= ?');
        queryParams.push(params.dateTo);
      }

      const whereClause = `WHERE ${conditions.join(' AND ')}`;

      // 1. 獲取總數
      const [countRows] = await pool.execute<RowDataPacket[]>(
        `SELECT COUNT(DISTINCT p.id) as total
        FROM posts p
        ${whereClause}`,
        queryParams
      );

      const total = (countRows[0] as any).total;
      const totalPages = Math.ceil(total / limit);

      // 2. 獲取貼文列表
      let sortColumn = 'p.posted_at';
      if (sortBy === 'views') {
        sortColumn = 'pi.views';
      } else if (sortBy === 'engagement_rate') {
        sortColumn = 'engagement_rate_calc';
      }

      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT
          p.id,
          LEFT(COALESCE(pr.content, ''), 100) as content_preview,
          p.posted_at,
          COALESCE(pi.views, 0) as views,
          COALESCE(pi.likes, 0) as likes,
          COALESCE(pi.replies, 0) as replies,
          CASE
            WHEN pi.views > 0 THEN ((pi.likes + pi.replies + COALESCE(pi.reposts, 0)) / pi.views * 100)
            ELSE 0
          END as engagement_rate,
          CASE
            WHEN pi.views > 0 THEN ((pi.likes + pi.replies + COALESCE(pi.reposts, 0)) / pi.views * 100)
            ELSE 0
          END as engagement_rate_calc,
          COALESCE(p.media_type, 'TEXT') as media_type
        FROM posts p
        LEFT JOIN post_insights pi ON p.id = pi.post_id
        LEFT JOIN post_revisions pr ON p.id = pr.post_id AND pr.revision_no = (
          SELECT MAX(revision_no) FROM post_revisions WHERE post_id = p.id
        )
        ${whereClause}
        ORDER BY ${sortColumn} ${sortOrder}
        LIMIT ${limit} OFFSET ${offset}`,
        [...queryParams]
      );

      return {
        posts: rows as PostDetail[],
        total,
        page,
        totalPages,
      };
    } catch (error) {
      logger.error('Failed to get post details:', error);
      throw error;
    }
  }

  /**
   * 獲取熱力圖數據（星期 × 小時）
   */
  static async getHeatmapData(days: number = 30): Promise<number[][]> {
    const pool = getPool();

    try {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT
          DAYOFWEEK(p.posted_at) - 1 as day_of_week,
          HOUR(p.posted_at) as hour,
          COALESCE(AVG(
            CASE
              WHEN pi.views > 0 THEN ((pi.likes + pi.replies + COALESCE(pi.reposts, 0)) / pi.views * 100)
              ELSE 0
            END
          ), 0) as avg_engagement_rate
        FROM posts p
        LEFT JOIN post_insights pi ON p.id = pi.post_id
        WHERE p.status = 'POSTED'
          AND p.posted_at >= ?
        GROUP BY day_of_week, hour`,
        [startDate]
      );

      // 初始化 7 × 24 的矩陣
      const heatmap: number[][] = Array(7).fill(null).map(() => Array(24).fill(0));

      // 填充數據
      rows.forEach((row: any) => {
        heatmap[row.day_of_week][row.hour] = Number(row.avg_engagement_rate);
      });

      return heatmap;
    } catch (error) {
      logger.error('Failed to get heatmap data:', error);
      throw error;
    }
  }

  /**
   * 獲取最佳發文時段分析（按小時）
   */
  static async getHourlyAnalysis(days: number = 90): Promise<{
    hours: { hour: number; posts: number; avgEngagement: number; avgViews: number }[];
    bestHour: number;
  }> {
    const pool = getPool();

    try {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT
          HOUR(p.posted_at) as hour,
          COUNT(*) as posts,
          COALESCE(AVG(pi.views), 0) as avg_views,
          COALESCE(AVG(
            CASE
              WHEN pi.views > 0 THEN ((pi.likes + pi.replies + COALESCE(pi.reposts, 0)) / pi.views * 100)
              ELSE 0
            END
          ), 0) as avg_engagement_rate
        FROM posts p
        LEFT JOIN post_insights pi ON p.id = pi.post_id
        WHERE p.status = 'POSTED'
          AND p.posted_at >= ?
        GROUP BY hour
        ORDER BY hour`,
        [startDate]
      );

      const hours = rows.map((row: any) => ({
        hour: Number(row.hour),
        posts: Number(row.posts),
        avgEngagement: Number(row.avg_engagement_rate),
        avgViews: Number(row.avg_views),
      }));

      // 找出最佳時段
      let bestHour = 0;
      let maxEngagement = 0;
      hours.forEach((h) => {
        if (h.avgEngagement > maxEngagement && h.posts >= 2) {
          maxEngagement = h.avgEngagement;
          bestHour = h.hour;
        }
      });

      return { hours, bestHour };
    } catch (error) {
      logger.error('Failed to get hourly analysis:', error);
      throw error;
    }
  }

  /**
   * 獲取星期表現分析
   */
  static async getDayOfWeekAnalysis(days: number = 90): Promise<{
    days: { day: number; dayName: string; posts: number; avgEngagement: number; avgViews: number }[];
    bestDay: number;
  }> {
    const pool = getPool();
    const dayNames = ['日', '一', '二', '三', '四', '五', '六'];

    try {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT
          DAYOFWEEK(p.posted_at) - 1 as day_of_week,
          COUNT(*) as posts,
          COALESCE(AVG(pi.views), 0) as avg_views,
          COALESCE(AVG(
            CASE
              WHEN pi.views > 0 THEN ((pi.likes + pi.replies + COALESCE(pi.reposts, 0)) / pi.views * 100)
              ELSE 0
            END
          ), 0) as avg_engagement_rate
        FROM posts p
        LEFT JOIN post_insights pi ON p.id = pi.post_id
        WHERE p.status = 'POSTED'
          AND p.posted_at >= ?
        GROUP BY day_of_week
        ORDER BY day_of_week`,
        [startDate]
      );

      const daysData = rows.map((row: any) => ({
        day: Number(row.day_of_week),
        dayName: dayNames[row.day_of_week] || '?',
        posts: Number(row.posts),
        avgEngagement: Number(row.avg_engagement_rate),
        avgViews: Number(row.avg_views),
      }));

      // 找出最佳星期
      let bestDay = 0;
      let maxEngagement = 0;
      daysData.forEach((d) => {
        if (d.avgEngagement > maxEngagement && d.posts >= 2) {
          maxEngagement = d.avgEngagement;
          bestDay = d.day;
        }
      });

      return { days: daysData, bestDay };
    } catch (error) {
      logger.error('Failed to get day of week analysis:', error);
      throw error;
    }
  }

  /**
   * 獲取 Top N 表現最佳的貼文
   */
  static async getTopPerformingPosts(limit: number = 5, days: number = 90): Promise<{
    id: string;
    content: string;
    postedAt: string;
    views: number;
    likes: number;
    replies: number;
    engagementRate: number;
    postUrl?: string;
  }[]> {
    const pool = getPool();

    try {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);
      const startDateStr = startDate.toISOString().slice(0, 19).replace('T', ' ');

      // MySQL2 prepared statements don't support LIMIT with placeholders
      // Ensure limit is a safe integer
      const safeLimit = Math.max(1, Math.min(100, Math.floor(Number(limit) || 5)));

      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT
          p.id,
          MAX(pr.content) as content,
          p.posted_at,
          p.post_url,
          COALESCE(pi.views, 0) as views,
          COALESCE(pi.likes, 0) as likes,
          COALESCE(pi.replies, 0) as replies,
          COALESCE(pi.reposts, 0) as reposts,
          CASE
            WHEN COALESCE(pi.views, 0) > 0 THEN ((COALESCE(pi.likes, 0) + COALESCE(pi.replies, 0) + COALESCE(pi.reposts, 0)) / pi.views * 100)
            ELSE 0
          END as engagement_rate
        FROM posts p
        LEFT JOIN post_insights pi ON p.id = pi.post_id
        LEFT JOIN post_revisions pr ON p.id = pr.post_id
        WHERE p.status = 'POSTED'
          AND p.posted_at >= ?
          AND COALESCE(pi.views, 0) > 0
        GROUP BY p.id, p.posted_at, p.post_url, pi.views, pi.likes, pi.replies, pi.reposts
        ORDER BY engagement_rate DESC, views DESC
        LIMIT ${safeLimit}`,
        [startDateStr]
      );

      return rows.map((row: any) => ({
        id: row.id,
        content: row.content ? row.content.substring(0, 100) + (row.content.length > 100 ? '...' : '') : '',
        postedAt: row.posted_at,
        views: Number(row.views),
        likes: Number(row.likes),
        replies: Number(row.replies),
        engagementRate: Number(row.engagement_rate),
        postUrl: row.post_url,
      }));
    } catch (error) {
      logger.error('Failed to get top performing posts:', error);
      throw error;
    }
  }

  /**
   * 獲取內容長度分析
   */
  static async getContentLengthAnalysis(days: number = 90): Promise<{
    short: { count: number; avgEngagement: number };
    medium: { count: number; avgEngagement: number };
    long: { count: number; avgEngagement: number };
    recommendation: string;
  }> {
    const pool = getPool();

    try {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      // 短文 < 100 字，中等 100-300 字，長文 > 300 字
      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT
          CASE
            WHEN CHAR_LENGTH(pr.content) < 100 THEN 'short'
            WHEN CHAR_LENGTH(pr.content) <= 300 THEN 'medium'
            ELSE 'long'
          END as length_category,
          COUNT(*) as posts,
          COALESCE(AVG(
            CASE
              WHEN pi.views > 0 THEN ((pi.likes + pi.replies + COALESCE(pi.reposts, 0)) / pi.views * 100)
              ELSE 0
            END
          ), 0) as avg_engagement_rate
        FROM posts p
        LEFT JOIN post_insights pi ON p.id = pi.post_id
        LEFT JOIN post_revisions pr ON p.id = pr.post_id
        WHERE p.status = 'POSTED'
          AND p.posted_at >= ?
          AND pr.content IS NOT NULL
        GROUP BY length_category`,
        [startDate]
      );

      const result = {
        short: { count: 0, avgEngagement: 0 },
        medium: { count: 0, avgEngagement: 0 },
        long: { count: 0, avgEngagement: 0 },
        recommendation: '',
      };

      rows.forEach((row: any) => {
        const category = row.length_category as 'short' | 'medium' | 'long';
        if (result[category]) {
          result[category].count = Number(row.posts);
          result[category].avgEngagement = Number(row.avg_engagement_rate);
        }
      });

      // 產生建議
      const categories = [
        { name: '短文 (< 100 字)', ...result.short },
        { name: '中等 (100-300 字)', ...result.medium },
        { name: '長文 (> 300 字)', ...result.long },
      ].filter(c => c.count > 0);

      if (categories.length > 0) {
        const best = categories.reduce((a, b) => a.avgEngagement > b.avgEngagement ? a : b);
        result.recommendation = `${best.name} 的參與率最高 (${best.avgEngagement.toFixed(1)}%)`;
      } else {
        result.recommendation = '尚無足夠數據';
      }

      return result;
    } catch (error) {
      logger.error('Failed to get content length analysis:', error);
      throw error;
    }
  }
}
