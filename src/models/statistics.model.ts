/**
 * Statistics Model
 * 提供統計數據的資料庫查詢方法
 *
 * 注意：此模型基於實際的資料庫結構設計
 * - posts 表沒有 content 欄位，內容在 post_revisions 表
 * - content_templates 表使用 preferred_engine 而非 engine
 * - schedule_time_slots 沒有 day_of_week/hour，使用 start_hour/start_minute 等
 * - 統計基於 post_performance_log 表（已有完整的統計欄位）
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
   * 獲取統計總覽數據
   * 基於 post_performance_log 表
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

      // 1. 獲取總覽統計（從 post_performance_log）
      const [overviewRows] = await pool.execute<RowDataPacket[]>(
        `SELECT
          COUNT(DISTINCT ppl.post_id) as total_posts,
          COALESCE(SUM(ppl.views), 0) as total_views,
          COALESCE(SUM(ppl.likes), 0) as total_likes,
          COALESCE(SUM(ppl.replies), 0) as total_replies,
          COALESCE(AVG(ppl.engagement_rate), 0) as avg_engagement_rate
        FROM post_performance_log ppl
        WHERE ppl.posted_at >= ?
          AND ppl.posted_at <= ?`,
        [startDate, endDate]
      );

      const overview = overviewRows[0] as OverviewStats;

      // 2. 獲取趨勢數據（每日統計）
      const [trendRows] = await pool.execute<RowDataPacket[]>(
        `SELECT
          DATE(ppl.posted_at) as date,
          COALESCE(SUM(ppl.views), 0) as views,
          COALESCE(AVG(ppl.engagement_rate), 0) as engagement_rate
        FROM post_performance_log ppl
        WHERE ppl.posted_at >= ?
          AND ppl.posted_at <= ?
        GROUP BY DATE(ppl.posted_at)
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
   * 基於 content_templates 和 post_performance_log
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
          COUNT(DISTINCT ppl.post_id) as total_uses,
          COALESCE(AVG(ppl.engagement_rate), 0) as avg_engagement_rate,
          COALESCE(AVG(ppl.likes), 0) as avg_likes,
          COALESCE(AVG(ppl.views), 0) as avg_views,
          (
            SELECT CONCAT(
              CASE ppl2.day_of_week
                WHEN 0 THEN '週日'
                WHEN 1 THEN '週一'
                WHEN 2 THEN '週二'
                WHEN 3 THEN '週三'
                WHEN 4 THEN '週四'
                WHEN 5 THEN '週五'
                WHEN 6 THEN '週六'
              END,
              ' ',
              LPAD(ppl2.posted_hour, 2, '0'),
              ':',
              LPAD(ppl2.posted_minute, 2, '0')
            )
            FROM post_performance_log ppl2
            WHERE ppl2.template_id = t.id
              AND ppl2.engagement_rate IS NOT NULL
            ORDER BY ppl2.engagement_rate DESC
            LIMIT 1
          ) as best_performing_time
        FROM content_templates t
        LEFT JOIN post_performance_log ppl ON t.id = ppl.template_id
        WHERE ppl.posted_at >= ? OR ppl.posted_at IS NULL
        GROUP BY t.id, t.name, t.preferred_engine
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
   * 基於 schedule_time_slots 和 post_performance_log
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
          COUNT(DISTINCT ppl.post_id) as posts_count,
          COALESCE(AVG(ppl.engagement_rate), 0) as avg_engagement_rate,
          COALESCE(AVG(ppl.likes), 0) as avg_likes,
          COALESCE(AVG(ppl.views), 0) as avg_views
        FROM schedule_time_slots ts
        LEFT JOIN post_performance_log ppl ON ts.id = ppl.time_slot_id
        WHERE ppl.posted_at >= ? OR ppl.posted_at IS NULL
        GROUP BY ts.id, ts.name, ts.start_hour, ts.start_minute
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
   * 獲取貼文明細列表（支援分頁和篩選）
   * 基於 post_performance_log，JOIN posts 和 post_revisions 獲取內容
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
      const conditions: string[] = [];
      const queryParams: any[] = [];

      if (params.templateId) {
        conditions.push('ppl.template_id = ?');
        queryParams.push(params.templateId);
      }

      if (params.timeslotId) {
        conditions.push('ppl.time_slot_id = ?');
        queryParams.push(params.timeslotId);
      }

      if (params.dateFrom) {
        conditions.push('ppl.posted_at >= ?');
        queryParams.push(params.dateFrom);
      }

      if (params.dateTo) {
        conditions.push('ppl.posted_at <= ?');
        queryParams.push(params.dateTo);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      // 1. 獲取總數
      const [countRows] = await pool.execute<RowDataPacket[]>(
        `SELECT COUNT(DISTINCT ppl.post_id) as total
        FROM post_performance_log ppl
        ${whereClause}`,
        queryParams
      );

      const total = (countRows[0] as any).total;
      const totalPages = Math.ceil(total / limit);

      // 2. 獲取貼文列表
      const sortColumn = sortBy === 'engagement_rate' ? 'ppl.engagement_rate' :
                        sortBy === 'views' ? 'ppl.views' : 'ppl.posted_at';

      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT
          p.id,
          LEFT(pr.content, 100) as content_preview,
          ppl.posted_at,
          t.name as template_name,
          ts.name as timeslot_name,
          COALESCE(ppl.views, 0) as views,
          COALESCE(ppl.likes, 0) as likes,
          COALESCE(ppl.replies, 0) as replies,
          COALESCE(ppl.engagement_rate, 0) as engagement_rate,
          COALESCE(p.content_length, 0) as content_length,
          COALESCE(p.hashtag_count, 0) as hashtag_count,
          COALESCE(p.media_type, 'NONE') as media_type
        FROM post_performance_log ppl
        INNER JOIN posts p ON ppl.post_id = p.id
        LEFT JOIN post_revisions pr ON p.id = pr.post_id AND pr.revision_no = (
          SELECT MAX(revision_no) FROM post_revisions WHERE post_id = p.id
        )
        LEFT JOIN content_templates t ON ppl.template_id = t.id
        LEFT JOIN schedule_time_slots ts ON ppl.time_slot_id = ts.id
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
   * 基於 post_performance_log 的 day_of_week 和 posted_hour
   */
  static async getHeatmapData(days: number = 30): Promise<number[][]> {
    const pool = getPool();

    try {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT
          ppl.day_of_week,
          ppl.posted_hour,
          COALESCE(AVG(ppl.engagement_rate), 0) as avg_engagement_rate
        FROM post_performance_log ppl
        WHERE ppl.posted_at >= ?
        GROUP BY ppl.day_of_week, ppl.posted_hour`,
        [startDate]
      );

      // 初始化 7 × 24 的矩陣
      const heatmap: number[][] = Array(7).fill(null).map(() => Array(24).fill(0));

      // 填充數據
      rows.forEach((row: any) => {
        heatmap[row.day_of_week][row.posted_hour] = Number(row.avg_engagement_rate);
      });

      return heatmap;
    } catch (error) {
      logger.error('Failed to get heatmap data:', error);
      throw error;
    }
  }
}
