/**
 * Statistics Model
 * 提供統計數據的資料庫查詢方法
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

export interface TemplateStats {
  id: string;
  name: string;
  engine: string;
  total_uses: number;
  avg_engagement_rate: number;
  avg_likes: number;
  avg_views: number;
  best_performing_time?: string;
}

export interface TimeslotStats {
  id: string;
  day_of_week: number;
  hour: number;
  posts_count: number;
  avg_engagement_rate: number;
  avg_likes: number;
  avg_views: number;
}

export interface PostDetail {
  id: string;
  content: string;
  posted_at: string;
  template_name?: string;
  timeslot?: string;
  views: number;
  likes: number;
  replies: number;
  reposts: number;
  quotes: number;
  engagement_rate: number;
  content_length: number;
  hashtag_count: number;
  media_type: string;
}

export class StatisticsModel {
  /**
   * 獲取統計總覽數據
   */
  static async getOverviewStats(days: number = 7): Promise<{
    overview: OverviewStats;
    trend: TrendData;
  }> {
    const pool = getPool();

    try {
      // 計算時間範圍
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
          COALESCE(AVG(pi.engagement_rate), 0) as avg_engagement_rate
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
          COALESCE(AVG(pi.engagement_rate), 0) as engagement_rate
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
   * 獲取樣板統計數據
   */
  static async getTemplateStats(days: number = 30): Promise<TemplateStats[]> {
    const pool = getPool();

    try {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT
          t.id,
          t.name,
          t.engine,
          COUNT(DISTINCT p.id) as total_uses,
          COALESCE(AVG(pi.engagement_rate), 0) as avg_engagement_rate,
          COALESCE(AVG(pi.likes), 0) as avg_likes,
          COALESCE(AVG(pi.views), 0) as avg_views,
          (
            SELECT CONCAT(
              CASE ts.day_of_week
                WHEN 0 THEN '週日'
                WHEN 1 THEN '週一'
                WHEN 2 THEN '週二'
                WHEN 3 THEN '週三'
                WHEN 4 THEN '週四'
                WHEN 5 THEN '週五'
                WHEN 6 THEN '週六'
              END,
              ' ',
              LPAD(ts.hour, 2, '0'),
              ':00'
            )
            FROM posts p2
            LEFT JOIN post_insights pi2 ON p2.id = pi2.post_id
            LEFT JOIN schedule_time_slots ts ON p2.time_slot_id = ts.id
            WHERE p2.template_id = t.id
              AND p2.status = 'POSTED'
              AND pi2.engagement_rate IS NOT NULL
            ORDER BY pi2.engagement_rate DESC
            LIMIT 1
          ) as best_performing_time
        FROM content_templates t
        LEFT JOIN posts p ON t.id = p.template_id
        LEFT JOIN post_insights pi ON p.id = pi.post_id
        WHERE p.status = 'POSTED'
          AND p.posted_at >= ?
        GROUP BY t.id, t.name, t.engine
        ORDER BY avg_engagement_rate DESC`,
        [startDate]
      );

      return rows as TemplateStats[];
    } catch (error) {
      logger.error('Failed to get template stats:', error);
      throw error;
    }
  }

  /**
   * 獲取時段統計數據
   */
  static async getTimeslotStats(days: number = 30): Promise<TimeslotStats[]> {
    const pool = getPool();

    try {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT
          ts.id,
          ts.day_of_week,
          ts.hour,
          COUNT(DISTINCT p.id) as posts_count,
          COALESCE(AVG(pi.engagement_rate), 0) as avg_engagement_rate,
          COALESCE(AVG(pi.likes), 0) as avg_likes,
          COALESCE(AVG(pi.views), 0) as avg_views
        FROM schedule_time_slots ts
        LEFT JOIN posts p ON ts.id = p.time_slot_id
        LEFT JOIN post_insights pi ON p.id = pi.post_id
        WHERE p.status = 'POSTED'
          AND p.posted_at >= ?
        GROUP BY ts.id, ts.day_of_week, ts.hour
        ORDER BY ts.day_of_week ASC, ts.hour ASC`,
        [startDate]
      );

      return rows as TimeslotStats[];
    } catch (error) {
      logger.error('Failed to get timeslot stats:', error);
      throw error;
    }
  }

  /**
   * 獲取貼文明細列表（支援分頁和篩選）
   */
  static async getPostDetails(params: {
    page?: number;
    limit?: number;
    sortBy?: 'posted_at' | 'views' | 'engagement_rate';
    sortOrder?: 'ASC' | 'DESC';
    templateId?: string;
    timeslotId?: string;
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

      if (params.templateId) {
        conditions.push('p.template_id = ?');
        queryParams.push(params.templateId);
      }

      if (params.timeslotId) {
        conditions.push('p.time_slot_id = ?');
        queryParams.push(params.timeslotId);
      }

      if (params.dateFrom) {
        conditions.push('p.posted_at >= ?');
        queryParams.push(params.dateFrom);
      }

      if (params.dateTo) {
        conditions.push('p.posted_at <= ?');
        queryParams.push(params.dateTo);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

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
      const sortColumn = sortBy === 'engagement_rate' ? 'pi.engagement_rate' :
                        sortBy === 'views' ? 'pi.views' : 'p.posted_at';

      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT
          p.id,
          p.content,
          p.posted_at,
          t.name as template_name,
          CONCAT(
            CASE ts.day_of_week
              WHEN 0 THEN '週日'
              WHEN 1 THEN '週一'
              WHEN 2 THEN '週二'
              WHEN 3 THEN '週三'
              WHEN 4 THEN '週四'
              WHEN 5 THEN '週五'
              WHEN 6 THEN '週六'
            END,
            ' ',
            LPAD(ts.hour, 2, '0'),
            ':00'
          ) as timeslot,
          COALESCE(pi.views, 0) as views,
          COALESCE(pi.likes, 0) as likes,
          COALESCE(pi.replies, 0) as replies,
          COALESCE(pi.reposts, 0) as reposts,
          COALESCE(pi.quotes, 0) as quotes,
          COALESCE(pi.engagement_rate, 0) as engagement_rate,
          p.content_length,
          p.hashtag_count,
          p.media_type
        FROM posts p
        LEFT JOIN post_insights pi ON p.id = pi.post_id
        LEFT JOIN content_templates t ON p.template_id = t.id
        LEFT JOIN schedule_time_slots ts ON p.time_slot_id = ts.id
        ${whereClause}
        ORDER BY ${sortColumn} ${sortOrder}
        LIMIT ? OFFSET ?`,
        [...queryParams, limit, offset]
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
          ts.day_of_week,
          ts.hour,
          COALESCE(AVG(pi.engagement_rate), 0) as avg_engagement_rate
        FROM schedule_time_slots ts
        LEFT JOIN posts p ON ts.id = p.time_slot_id
        LEFT JOIN post_insights pi ON p.id = pi.post_id
        WHERE p.status = 'POSTED'
          AND p.posted_at >= ?
        GROUP BY ts.day_of_week, ts.hour`,
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
}
