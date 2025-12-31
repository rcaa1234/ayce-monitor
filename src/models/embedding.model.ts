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

    console.log('🔍 [EMBEDDING] getRecentPosted called - USING UPDATED CODE WITH FILTER');

    try {
      // First get recent posted post IDs - using query instead of execute to avoid prepared statement issues
      const [posts] = await pool.query<RowDataPacket[]>(
        `SELECT id FROM posts WHERE status = 'POSTED' ORDER BY posted_at DESC LIMIT ${limit}`
      );

      if (posts.length === 0) {
        return [];
      }

      const postIds = posts.map(p => p.id);

      // Get embeddings and latest revisions for these posts
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT
           e.post_id,
           e.embedding_json,
           (SELECT content FROM post_revisions WHERE post_id = e.post_id ORDER BY revision_no DESC LIMIT 1) as content
         FROM post_embeddings e
         WHERE e.post_id IN (${postIds.map(() => '?').join(',')})`,
        postIds
      );

      return rows
        .map((row) => {
          let embedding: number[] = [];

          if (row.embedding_json) {
            try {
              // Try to parse the embedding_json
              const parsed = typeof row.embedding_json === 'string'
                ? JSON.parse(row.embedding_json)
                : row.embedding_json;
              embedding = Array.isArray(parsed) ? parsed : [];
            } catch (error) {
              console.error(`Failed to parse embedding for post ${row.post_id}:`, error);
              console.error('Raw value:', row.embedding_json);
              // Return empty array on parse error
              embedding = [];
            }
          }

          return {
            post_id: row.post_id,
            embedding,
            content: row.content,
          };
        })
        .filter(item => item.embedding.length > 0); // 過濾掉空 embedding
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
