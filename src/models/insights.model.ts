import { getPool } from '../database/connection';
import { PostInsights, AccountInsights, PeriodType } from '../types';
import { RowDataPacket, ResultSetHeader } from 'mysql2';
import { v4 as uuidv4 } from 'uuid';

export class InsightsModel {
  /**
   * Save or update post insights
   */
  static async savePostInsights(insights: Omit<PostInsights, 'id' | 'created_at' | 'fetched_at'>): Promise<void> {
    const pool = getPool();
    const id = uuidv4();

    await pool.execute<ResultSetHeader>(
      `INSERT INTO post_insights (
        id, post_id, views, likes, replies, reposts, quotes, shares, engagement_rate
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        views = VALUES(views),
        likes = VALUES(likes),
        replies = VALUES(replies),
        reposts = VALUES(reposts),
        quotes = VALUES(quotes),
        shares = VALUES(shares),
        engagement_rate = VALUES(engagement_rate),
        fetched_at = CURRENT_TIMESTAMP`,
      [
        id,
        insights.post_id,
        insights.views,
        insights.likes,
        insights.replies,
        insights.reposts,
        insights.quotes,
        insights.shares,
        insights.engagement_rate,
      ]
    );
  }

  /**
   * Get latest insights for a post
   */
  static async getPostInsights(postId: string): Promise<PostInsights | null> {
    const pool = getPool();

    const [rows] = await pool.execute<RowDataPacket[]>(
      'SELECT * FROM post_insights WHERE post_id = ? ORDER BY fetched_at DESC LIMIT 1',
      [postId]
    );

    return rows[0] ? (rows[0] as PostInsights) : null;
  }

  /**
   * Get insights for multiple posts
   */
  static async getMultiplePostInsights(postIds: string[]): Promise<PostInsights[]> {
    if (postIds.length === 0) return [];

    const pool = getPool();
    const placeholders = postIds.map(() => '?').join(',');

    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT pi.* FROM post_insights pi
       INNER JOIN (
         SELECT post_id, MAX(fetched_at) as latest_fetch
         FROM post_insights
         WHERE post_id IN (${placeholders})
         GROUP BY post_id
       ) latest ON pi.post_id = latest.post_id AND pi.fetched_at = latest.latest_fetch`,
      postIds
    );

    return rows as PostInsights[];
  }

  /**
   * Get all post insights history for a post
   */
  static async getPostInsightsHistory(postId: string, limit = 30): Promise<PostInsights[]> {
    const pool = getPool();

    // MySQL2 prepared statements don't support LIMIT with placeholders
    const safeLimit = Math.max(1, Math.min(100, Math.floor(Number(limit) || 30)));

    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT * FROM post_insights WHERE post_id = ? ORDER BY fetched_at DESC LIMIT ${safeLimit}`,
      [postId]
    );

    return rows as PostInsights[];
  }

  /**
   * Save account insights for a period
   */
  static async saveAccountInsights(insights: Omit<AccountInsights, 'id' | 'created_at' | 'fetched_at'>): Promise<void> {
    const pool = getPool();
    const id = uuidv4();

    await pool.execute<ResultSetHeader>(
      `INSERT INTO account_insights (
        id, account_id, followers_count, following_count, posts_count,
        period_views, period_interactions, period_new_followers, period_posts,
        period_start, period_end, period_type
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        followers_count = VALUES(followers_count),
        following_count = VALUES(following_count),
        posts_count = VALUES(posts_count),
        period_views = VALUES(period_views),
        period_interactions = VALUES(period_interactions),
        period_new_followers = VALUES(period_new_followers),
        period_posts = VALUES(period_posts),
        fetched_at = CURRENT_TIMESTAMP`,
      [
        id,
        insights.account_id,
        insights.followers_count,
        insights.following_count,
        insights.posts_count,
        insights.period_views,
        insights.period_interactions,
        insights.period_new_followers,
        insights.period_posts,
        insights.period_start,
        insights.period_end,
        insights.period_type,
      ]
    );
  }

  /**
   * Get latest account insights
   */
  static async getAccountInsights(accountId: string, periodType: PeriodType = PeriodType.WEEKLY): Promise<AccountInsights | null> {
    const pool = getPool();

    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT * FROM account_insights
       WHERE account_id = ? AND period_type = ?
       ORDER BY period_end DESC
       LIMIT 1`,
      [accountId, periodType]
    );

    return rows[0] ? (rows[0] as AccountInsights) : null;
  }

  /**
   * Get account insights history
   */
  static async getAccountInsightsHistory(
    accountId: string,
    periodType: PeriodType = PeriodType.WEEKLY,
    limit = 12
  ): Promise<AccountInsights[]> {
    const pool = getPool();

    // MySQL2 prepared statements don't support LIMIT with placeholders
    const safeLimit = Math.max(1, Math.min(100, Math.floor(Number(limit) || 12)));

    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT * FROM account_insights
       WHERE account_id = ? AND period_type = ?
       ORDER BY period_end DESC
       LIMIT ${safeLimit}`,
      [accountId, periodType]
    );

    return rows as AccountInsights[];
  }

  /**
   * Get total engagement for a time period
   */
  static async getTotalEngagement(accountId: string, startDate: Date, endDate: Date): Promise<{
    total_views: number;
    total_likes: number;
    total_replies: number;
    total_reposts: number;
    total_shares: number;
    post_count: number;
  }> {
    const pool = getPool();

    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT
        COALESCE(SUM(pi.views), 0) as total_views,
        COALESCE(SUM(pi.likes), 0) as total_likes,
        COALESCE(SUM(pi.replies), 0) as total_replies,
        COALESCE(SUM(pi.reposts), 0) as total_reposts,
        COALESCE(SUM(pi.shares), 0) as total_shares,
        COUNT(DISTINCT pi.post_id) as post_count
      FROM post_insights pi
      INNER JOIN posts p ON pi.post_id = p.id
      WHERE p.status = 'POSTED'
        AND pi.fetched_at BETWEEN ? AND ?
        AND pi.id IN (
          SELECT id FROM (
            SELECT MAX(id) as id FROM post_insights GROUP BY post_id
          ) latest
        )`,
      [startDate, endDate]
    );

    return rows[0] as any;
  }

  /**
   * Delete old insights data (cleanup)
   */
  static async deleteOldInsights(daysToKeep = 90): Promise<void> {
    const pool = getPool();
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

    await pool.execute(
      'DELETE FROM post_insights WHERE fetched_at < ?',
      [cutoffDate]
    );

    await pool.execute(
      'DELETE FROM account_insights WHERE fetched_at < ?',
      [cutoffDate]
    );
  }
}
