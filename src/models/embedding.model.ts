import { getPool } from '../database/connection';
import { PostEmbedding } from '../types';
import { RowDataPacket, ResultSetHeader } from 'mysql2';

export class EmbeddingModel {
  /**
   * Save embedding for a post
   */
  static async save(postId: string, embedding: number[]): Promise<void> {
    const pool = getPool();

    await pool.execute<ResultSetHeader>(
      `INSERT INTO post_embeddings (post_id, embedding_json)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE embedding_json = ?`,
      [postId, JSON.stringify(embedding), JSON.stringify(embedding)]
    );
  }

  /**
   * Get embedding for a post
   */
  static async findByPostId(postId: string): Promise<PostEmbedding | null> {
    const pool = getPool();

    const [rows] = await pool.execute<RowDataPacket[]>(
      'SELECT * FROM post_embeddings WHERE post_id = ?',
      [postId]
    );

    if (rows[0]) {
      return {
        ...rows[0],
        embedding_json: JSON.parse(rows[0].embedding_json),
      } as PostEmbedding;
    }

    return null;
  }

  /**
   * Get embeddings for recently posted content
   */
  static async getRecentPosted(limit: number = 60): Promise<Array<{
    post_id: string;
    embedding: number[];
    content?: string;
  }>> {
    const pool = getPool();

    try {
      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT e.post_id, e.embedding_json, pr.content
         FROM post_embeddings e
         INNER JOIN posts p ON e.post_id = p.id
         LEFT JOIN (
           SELECT post_id, content, revision_no
           FROM post_revisions pr1
           WHERE (post_id, revision_no) IN (
             SELECT post_id, MAX(revision_no)
             FROM post_revisions
             GROUP BY post_id
           )
         ) pr ON p.id = pr.post_id
         WHERE p.status = 'POSTED'
         ORDER BY p.posted_at DESC
         LIMIT ?`,
        [limit]
      );

      return rows.map((row) => ({
        post_id: row.post_id,
        embedding: row.embedding_json ? JSON.parse(row.embedding_json) : [],
        content: row.content,
      }));
    } catch (error) {
      console.error('Error fetching recent posted embeddings:', error);
      // Return empty array on error to allow content generation to continue
      return [];
    }
  }

  /**
   * Delete embedding for a post
   */
  static async delete(postId: string): Promise<void> {
    const pool = getPool();

    await pool.execute('DELETE FROM post_embeddings WHERE post_id = ?', [postId]);
  }
}
