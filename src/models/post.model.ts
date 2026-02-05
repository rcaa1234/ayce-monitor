import { getPool } from '../database/connection';
import { Post, PostStatus, PostRevision, EngineType } from '../types';
import { generateUUID } from '../utils/uuid';
import { RowDataPacket, ResultSetHeader } from 'mysql2';

export class PostModel {
  /**
   * Create a new post
   */
  static async create(data: {
    created_by: string;
    status?: PostStatus;
    template_id?: string; // 模板 ID
    is_ai_generated?: boolean; // 是否為 AI 生成
    threads_account_id?: string; // 保留參數以維持向後相容,但不使用
    scheduled_for?: Date | null; // 保留參數以維持向後相容,但不使用
  }): Promise<Post> {
    const pool = getPool();
    const id = generateUUID();

    // 包含 template_id 和 is_ai_generated 的 INSERT
    await pool.execute<ResultSetHeader>(
      `INSERT INTO posts (id, status, created_by, template_id, is_ai_generated) VALUES (?, ?, ?, ?, ?)`,
      [id, data.status || PostStatus.DRAFT, data.created_by, data.template_id || null, data.is_ai_generated || false]
    );

    return this.findById(id) as Promise<Post>;
  }

  /**
   * Find post by ID
   */
  static async findById(id: string): Promise<Post | null> {
    const pool = getPool();

    const [rows] = await pool.execute<RowDataPacket[]>(
      'SELECT * FROM posts WHERE id = ?',
      [id]
    );

    return rows[0] ? (rows[0] as Post) : null;
  }

  /**
   * Update post status
   */
  static async updateStatus(
    id: string,
    status: PostStatus,
    additionalData?: {
      approved_by?: string;
      approved_at?: Date;
      posted_at?: Date;
      post_url?: string;
      threads_media_id?: string;
      last_error_code?: string;
      last_error_message?: string;
    }
  ): Promise<void> {
    const pool = getPool();
    const fields: string[] = ['status = ?'];
    const values: any[] = [status];

    if (additionalData) {
      if (additionalData.approved_by) {
        fields.push('approved_by = ?');
        values.push(additionalData.approved_by);
      }
      if (additionalData.approved_at) {
        fields.push('approved_at = ?');
        values.push(additionalData.approved_at);
      }
      if (additionalData.posted_at) {
        fields.push('posted_at = ?');
        values.push(additionalData.posted_at);
      }
      if (additionalData.post_url) {
        fields.push('post_url = ?');
        values.push(additionalData.post_url);
      }
      if (additionalData.threads_media_id) {
        fields.push('threads_media_id = ?');
        values.push(additionalData.threads_media_id);
      }
      if (additionalData.last_error_code) {
        fields.push('last_error_code = ?');
        values.push(additionalData.last_error_code);
      }
      if (additionalData.last_error_message) {
        fields.push('last_error_message = ?');
        values.push(additionalData.last_error_message);
      }
    }

    values.push(id);

    await pool.execute(
      `UPDATE posts SET ${fields.join(', ')} WHERE id = ?`,
      values
    );
  }

  /**
   * Get posts by status
   */
  static async findByStatus(status: PostStatus, limit?: number): Promise<Post[]> {
    const pool = getPool();
    let query = 'SELECT * FROM posts WHERE status = ? ORDER BY created_at DESC';
    const params: any[] = [status];

    // MySQL2 prepared statements don't support LIMIT with placeholders
    if (limit) {
      const safeLimit = Math.max(1, Math.min(1000, Math.floor(Number(limit))));
      query += ` LIMIT ${safeLimit}`;
    }

    const [rows] = await pool.execute<RowDataPacket[]>(query, params);

    return rows as Post[];
  }

  /**
   * Get recently posted content for similarity check
   */
  static async getRecentPosted(limit: number = 60): Promise<Array<{ id: string; content: string }>> {
    const pool = getPool();

    // MySQL2 prepared statements don't support LIMIT with placeholders
    const safeLimit = Math.max(1, Math.min(500, Math.floor(Number(limit) || 60)));

    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT p.id, pr.content
       FROM posts p
       INNER JOIN post_revisions pr ON p.id = pr.post_id AND pr.revision_no = (
         SELECT MAX(revision_no) FROM post_revisions WHERE post_id = p.id
       )
       WHERE p.status = 'POSTED'
       ORDER BY p.posted_at DESC
       LIMIT ${safeLimit}`,
      []
    );

    return rows as Array<{ id: string; content: string }>;
  }

  /**
   * Create a revision for a post
   */
  static async createRevision(data: {
    post_id: string;
    title?: string;
    content: string;
    engine_used: EngineType;
    similarity_max: number;
    similarity_hits?: Array<{ post_id: string; similarity: number }>;
    generation_params?: Record<string, any>;
  }): Promise<PostRevision> {
    const pool = getPool();
    const id = generateUUID();

    // Get next revision number
    const [countRows] = await pool.execute<RowDataPacket[]>(
      'SELECT COALESCE(MAX(revision_no), 0) + 1 as next_no FROM post_revisions WHERE post_id = ?',
      [data.post_id]
    );

    const revisionNo = countRows[0].next_no;

    await pool.execute<ResultSetHeader>(
      `INSERT INTO post_revisions
       (id, post_id, revision_no, title, content, engine_used, similarity_max, similarity_hits, generation_params)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        data.post_id,
        revisionNo,
        data.title || null,
        data.content,
        data.engine_used,
        data.similarity_max,
        data.similarity_hits ? JSON.stringify(data.similarity_hits) : null,
        data.generation_params ? JSON.stringify(data.generation_params) : null,
      ]
    );

    return this.findRevisionById(id) as Promise<PostRevision>;
  }

  /**
   * Find revision by ID
   */
  static async findRevisionById(id: string): Promise<PostRevision | null> {
    const pool = getPool();

    const [rows] = await pool.execute<RowDataPacket[]>(
      'SELECT * FROM post_revisions WHERE id = ?',
      [id]
    );

    if (rows[0]) {
      const row = rows[0];
      return {
        ...row,
        similarity_hits: (row.similarity_hits && row.similarity_hits.length > 0)
          ? (typeof row.similarity_hits === 'string' ? JSON.parse(row.similarity_hits) : row.similarity_hits)
          : null,
        generation_params: (row.generation_params && row.generation_params.length > 0)
          ? (typeof row.generation_params === 'string' ? JSON.parse(row.generation_params) : row.generation_params)
          : null,
      } as PostRevision;
    }

    return null;
  }

  /**
   * Get all revisions for a post
   */
  static async getRevisions(postId: string): Promise<PostRevision[]> {
    const pool = getPool();

    const [rows] = await pool.execute<RowDataPacket[]>(
      'SELECT * FROM post_revisions WHERE post_id = ? ORDER BY revision_no DESC',
      [postId]
    );

    return rows.map((row) => ({
      ...row,
      similarity_hits: (row.similarity_hits && row.similarity_hits.length > 0)
        ? (typeof row.similarity_hits === 'string' ? JSON.parse(row.similarity_hits) : row.similarity_hits)
        : null,
      generation_params: (row.generation_params && row.generation_params.length > 0)
        ? (typeof row.generation_params === 'string' ? JSON.parse(row.generation_params) : row.generation_params)
        : null,
    })) as PostRevision[];
  }

  /**
   * Get latest revision for a post
   */
  static async getLatestRevision(postId: string): Promise<PostRevision | null> {
    const pool = getPool();

    const [rows] = await pool.execute<RowDataPacket[]>(
      'SELECT * FROM post_revisions WHERE post_id = ? ORDER BY revision_no DESC LIMIT 1',
      [postId]
    );

    if (rows[0]) {
      const row = rows[0];
      return {
        ...row,
        similarity_hits: row.similarity_hits
          ? (typeof row.similarity_hits === 'string' ? JSON.parse(row.similarity_hits) : row.similarity_hits)
          : null,
        generation_params: row.generation_params
          ? (typeof row.generation_params === 'string' ? JSON.parse(row.generation_params) : row.generation_params)
          : null,
      } as PostRevision;
    }

    return null;
  }

  /**
   * Update post fields
   */
  static async update(
    id: string,
    updates: {
      topic?: string;
      keywords?: string[];
      target_tone?: string;
      target_length?: number;
      scheduled_for?: Date | null;
    }
  ): Promise<void> {
    const pool = getPool();
    const fields: string[] = [];
    const values: any[] = [];

    if (updates.topic !== undefined) {
      fields.push('topic = ?');
      values.push(updates.topic);
    }
    if (updates.keywords !== undefined) {
      fields.push('keywords = ?');
      values.push(JSON.stringify(updates.keywords));
    }
    if (updates.target_tone !== undefined) {
      fields.push('target_tone = ?');
      values.push(updates.target_tone);
    }
    if (updates.target_length !== undefined) {
      fields.push('target_length = ?');
      values.push(updates.target_length);
    }
    if (updates.scheduled_for !== undefined) {
      fields.push('scheduled_for = ?');
      values.push(updates.scheduled_for);
    }

    if (fields.length === 0) return;

    fields.push('updated_at = NOW()');
    values.push(id);

    const query = `UPDATE posts SET ${fields.join(', ')} WHERE id = ?`;
    await pool.execute(query, values);
  }

  /**
   * Delete post (soft delete by updating status)
   */
  static async delete(id: string): Promise<void> {
    const pool = getPool();
    // Hard delete for now - can change to soft delete later
    await pool.execute('DELETE FROM posts WHERE id = ?', [id]);
  }

  /**
   * 取得歷史貼文（含最新 revision 內容 + engagement 數據）
   * 供 Agent API 使用
   */
  static async getHistoryWithEngagement(
    status?: string,
    limit: number = 20
  ): Promise<any[]> {
    const pool = getPool();
    const safeLimit = Math.max(1, Math.min(100, Math.floor(Number(limit) || 20)));

    let statusFilter = '';
    const params: any[] = [];

    if (status === 'published') {
      statusFilter = "AND p.status = 'POSTED'";
    } else if (status === 'scheduled') {
      statusFilter = "AND p.status IN ('APPROVED', 'PENDING_REVIEW')";
    } else if (status === 'draft') {
      statusFilter = "AND p.status = 'DRAFT'";
    }

    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT
         p.id,
         p.status,
         p.tags,
         p.context,
         p.post_url,
         p.posted_at,
         p.created_at,
         p.updated_at,
         pr.content,
         pr.title,
         pr.engine_used,
         pi.views,
         pi.likes,
         pi.replies,
         pi.reposts,
         pi.quotes,
         pi.shares,
         pi.engagement_rate,
         pi.fetched_at AS insights_fetched_at,
         das.scheduled_time,
         das.status AS schedule_status
       FROM posts p
       LEFT JOIN post_revisions pr ON p.id = pr.post_id AND pr.revision_no = (
         SELECT MAX(revision_no) FROM post_revisions WHERE post_id = p.id
       )
       LEFT JOIN post_insights pi ON p.id = pi.post_id AND pi.id = (
         SELECT id FROM post_insights WHERE post_id = p.id ORDER BY fetched_at DESC LIMIT 1
       )
       LEFT JOIN daily_auto_schedule das ON p.id = das.post_id AND das.status != 'CANCELLED'
       WHERE 1=1 ${statusFilter}
       ORDER BY p.created_at DESC
       LIMIT ${safeLimit}`,
      params
    );

    return rows.map(row => ({
      id: row.id,
      status: row.status,
      content: row.content,
      title: row.title,
      tags: row.tags ? (typeof row.tags === 'string' ? JSON.parse(row.tags) : row.tags) : null,
      context: row.context,
      engine_used: row.engine_used,
      post_url: row.post_url,
      posted_at: row.posted_at,
      created_at: row.created_at,
      updated_at: row.updated_at,
      scheduled_time: row.scheduled_time,
      schedule_status: row.schedule_status,
      engagement: row.views != null ? {
        views: row.views,
        likes: row.likes,
        replies: row.replies,
        reposts: row.reposts,
        quotes: row.quotes,
        shares: row.shares,
        engagement_rate: row.engagement_rate,
        fetched_at: row.insights_fetched_at,
      } : null,
    }));
  }

  /**
   * 取得高表現貼文（依 engagement_rate 排序）
   * 供 Agent API 使用
   */
  static async getTopPerforming(limit: number = 10): Promise<any[]> {
    const pool = getPool();
    const safeLimit = Math.max(1, Math.min(50, Math.floor(Number(limit) || 10)));

    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT
         p.id,
         p.status,
         p.tags,
         p.context,
         p.post_url,
         p.posted_at,
         pr.content,
         pr.title,
         pr.engine_used,
         pi.views,
         pi.likes,
         pi.replies,
         pi.reposts,
         pi.quotes,
         pi.shares,
         pi.engagement_rate,
         pi.fetched_at AS insights_fetched_at
       FROM posts p
       INNER JOIN post_insights pi ON p.id = pi.post_id AND pi.id = (
         SELECT id FROM post_insights WHERE post_id = p.id ORDER BY fetched_at DESC LIMIT 1
       )
       LEFT JOIN post_revisions pr ON p.id = pr.post_id AND pr.revision_no = (
         SELECT MAX(revision_no) FROM post_revisions WHERE post_id = p.id
       )
       WHERE p.status = 'POSTED'
       ORDER BY pi.engagement_rate DESC
       LIMIT ${safeLimit}`,
      []
    );

    return rows.map(row => ({
      id: row.id,
      content: row.content,
      title: row.title,
      tags: row.tags ? (typeof row.tags === 'string' ? JSON.parse(row.tags) : row.tags) : null,
      context: row.context,
      engine_used: row.engine_used,
      post_url: row.post_url,
      posted_at: row.posted_at,
      engagement: {
        views: row.views,
        likes: row.likes,
        replies: row.replies,
        reposts: row.reposts,
        quotes: row.quotes,
        shares: row.shares,
        engagement_rate: row.engagement_rate,
        fetched_at: row.insights_fetched_at,
      },
    }));
  }

  /**
   * 取得單一貼文完整狀態（含 revision、insights、schedule）
   * 供 Agent API 使用
   */
  static async getPostWithRevisionAndInsights(postId: string): Promise<any | null> {
    const pool = getPool();

    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT
         p.id,
         p.status,
         p.tags,
         p.context,
         p.post_url,
         p.posted_at,
         p.created_at,
         p.updated_at,
         p.last_error_code,
         p.last_error_message,
         pr.content,
         pr.title,
         pr.engine_used,
         pr.revision_no,
         pr.similarity_max,
         pi.views,
         pi.likes,
         pi.replies,
         pi.reposts,
         pi.quotes,
         pi.shares,
         pi.engagement_rate,
         pi.fetched_at AS insights_fetched_at,
         das.id AS schedule_id,
         das.scheduled_time,
         das.status AS schedule_status,
         das.selection_reason
       FROM posts p
       LEFT JOIN post_revisions pr ON p.id = pr.post_id AND pr.revision_no = (
         SELECT MAX(revision_no) FROM post_revisions WHERE post_id = p.id
       )
       LEFT JOIN post_insights pi ON p.id = pi.post_id AND pi.id = (
         SELECT id FROM post_insights WHERE post_id = p.id ORDER BY fetched_at DESC LIMIT 1
       )
       LEFT JOIN daily_auto_schedule das ON p.id = das.post_id AND das.status != 'CANCELLED'
       WHERE p.id = ?`,
      [postId]
    );

    if (!rows[0]) return null;

    const row = rows[0];
    return {
      id: row.id,
      status: row.status,
      content: row.content,
      title: row.title,
      tags: row.tags ? (typeof row.tags === 'string' ? JSON.parse(row.tags) : row.tags) : null,
      context: row.context,
      engine_used: row.engine_used,
      revision_no: row.revision_no,
      similarity_max: row.similarity_max,
      post_url: row.post_url,
      posted_at: row.posted_at,
      created_at: row.created_at,
      updated_at: row.updated_at,
      error: row.last_error_code ? {
        code: row.last_error_code,
        message: row.last_error_message,
      } : null,
      schedule: row.schedule_id ? {
        id: row.schedule_id,
        scheduled_time: row.scheduled_time,
        status: row.schedule_status,
        selection_reason: row.selection_reason,
      } : null,
      engagement: row.views != null ? {
        views: row.views,
        likes: row.likes,
        replies: row.replies,
        reposts: row.reposts,
        quotes: row.quotes,
        shares: row.shares,
        engagement_rate: row.engagement_rate,
        fetched_at: row.insights_fetched_at,
      } : null,
    };
  }
}
