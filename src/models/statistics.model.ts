/**
 * Statistics Model
 * 提供統計數據的資料庫查詢方法
 *
 * 數據來源：所有已發布的貼文（不限於UCB排程）
 * - 基於 posts 表（status = 'POSTED'）
 * - LEFT JOIN post_insights 獲取互動數據
 * - LEFT JOIN content_templates 和 schedule_time_slots 獲取關聯資訊
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
  preferred_engine: string;
  total_uses: number;
  avg_engagement_rate: number;
  avg_likes: number;
  avg_views: number;
  best_performing_time?: string;
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
  template_name?: string;
  timeslot_name?: string;
  views: number;
  likes: number;
  replies: number;
  engagement_rate: number;
  content_length: number;
  hashtag_count: number;
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
          COALESCE(t.preferred_engine, 'GPT5_2') as preferred_engine,
          COUNT(DISTINCT p.id) as total_uses,
          COALESCE(AVG(
            CASE
              WHEN pi.views > 0 THEN ((pi.likes + pi.replies + COALESCE(pi.reposts, 0)) / pi.views * 100)
              ELSE 0
            END
          ), 0) as avg_engagement_rate,
          COALESCE(AVG(pi.likes), 0) as avg_likes,
          COALESCE(AVG(pi.views), 0) as avg_views,
          (
            SELECT CONCAT(
              DATE_FORMAT(p2.posted_at, '%W'),
              ' ',
              DATE_FORMAT(p2.posted_at, '%H:%i')
            )
            FROM posts p2
            LEFT JOIN post_insights pi2 ON p2.id = pi2.post_id
            WHERE p2.template_id = t.id
              AND p2.status = 'POSTED'
              AND pi2.views IS NOT NULL
            ORDER BY (
              CASE
                WHEN pi2.views > 0 THEN ((pi2.likes + pi2.replies + COALESCE(pi2.reposts, 0)) / pi2.views)
                ELSE 0
              END
            ) DESC
            LIMIT 1
          ) as best_performing_time
        FROM content_templates t
        LEFT JOIN posts p ON t.id = p.template_id AND p.status = 'POSTED'
        LEFT JOIN post_insights pi ON p.id = pi.post_id
        WHERE p.posted_at >= ? OR p.posted_at IS NULL
        GROUP BY t.id, t.name, t.preferred_engine
        HAVING total_uses > 0
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
          ts.name,
          ts.start_hour,
          ts.start_minute,
          COUNT(DISTINCT p.id) as posts_count,
          COALESCE(AVG(
            CASE
              WHEN pi.views > 0 THEN ((pi.likes + pi.replies + COALESCE(pi.reposts, 0)) / pi.views * 100)
              ELSE 0
            END
          ), 0) as avg_engagement_rate,
          COALESCE(AVG(pi.likes), 0) as avg_likes,
          COALESCE(AVG(pi.views), 0) as avg_views
        FROM schedule_time_slots ts
        LEFT JOIN posts p ON ts.id = p.time_slot_id AND p.status = 'POSTED'
        LEFT JOIN post_insights pi ON p.id = pi.post_id
        WHERE p.posted_at >= ? OR p.posted_at IS NULL
        GROUP BY ts.id, ts.name, ts.start_hour, ts.start_minute
        HAVING posts_count > 0
        ORDER BY ts.start_hour ASC, ts.start_minute ASC`,
        [startDate]
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
          t.name as template_name,
          ts.name as timeslot_name,
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
          COALESCE(p.content_length, 0) as content_length,
          COALESCE(p.hashtag_count, 0) as hashtag_count,
          COALESCE(p.media_type, 'NONE') as media_type
        FROM posts p
        LEFT JOIN post_insights pi ON p.id = pi.post_id
        LEFT JOIN post_revisions pr ON p.id = pr.post_id AND pr.revision_no = (
          SELECT MAX(revision_no) FROM post_revisions WHERE post_id = p.id
        )
        LEFT JOIN content_templates t ON p.template_id = t.id
        LEFT JOIN schedule_time_slots ts ON p.time_slot_id = ts.id
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
}
