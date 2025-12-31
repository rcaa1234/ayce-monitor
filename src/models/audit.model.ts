import { getPool } from '../database/connection';
import { AuditLog } from '../types';
import { generateUUID } from '../utils/uuid';
import { RowDataPacket, ResultSetHeader } from 'mysql2';

export class AuditModel {
  /**
   * Create an audit log entry
   */
  static async log(data: {
    actor_user_id?: string;
    action: string;
    target_type: string;
    target_id: string;
    metadata?: Record<string, any>;
  }): Promise<AuditLog> {
    const pool = getPool();
    const id = generateUUID();

    await pool.execute<ResultSetHeader>(
      `INSERT INTO audit_logs (id, actor_user_id, action, target_type, target_id, metadata)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        id,
        data.actor_user_id || null,
        data.action,
        data.target_type,
        data.target_id,
        data.metadata ? JSON.stringify(data.metadata) : null,
      ]
    );

    return this.findById(id) as Promise<AuditLog>;
  }

  /**
   * Find audit log by ID
   */
  static async findById(id: string): Promise<AuditLog | null> {
    const pool = getPool();

    const [rows] = await pool.execute<RowDataPacket[]>(
      'SELECT * FROM audit_logs WHERE id = ?',
      [id]
    );

    if (rows[0]) {
      return {
        ...rows[0],
        metadata: rows[0].metadata
          ? (typeof rows[0].metadata === 'string' ? JSON.parse(rows[0].metadata) : rows[0].metadata)
          : null,
      } as AuditLog;
    }

    return null;
  }

  /**
   * Get audit logs for a target
   */
  static async findByTarget(
    targetType: string,
    targetId: string,
    limit: number = 50
  ): Promise<AuditLog[]> {
    const pool = getPool();

    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT * FROM audit_logs
       WHERE target_type = ? AND target_id = ?
       ORDER BY created_at DESC
       LIMIT ?`,
      [targetType, targetId, limit]
    );

    return rows.map((row) => ({
      ...row,
      metadata: row.metadata
        ? (typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata)
        : null,
    })) as AuditLog[];
  }

  /**
   * Get audit logs by actor
   */
  static async findByActor(userId: string, limit: number = 50): Promise<AuditLog[]> {
    const pool = getPool();

    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT * FROM audit_logs
       WHERE actor_user_id = ?
       ORDER BY created_at DESC
       LIMIT ?`,
      [userId, limit]
    );

    return rows.map((row) => ({
      ...row,
      metadata: row.metadata
        ? (typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata)
        : null,
    })) as AuditLog[];
  }

  /**
   * Get recent audit logs
   */
  static async getRecent(limit: number = 100): Promise<AuditLog[]> {
    const pool = getPool();

    const [rows] = await pool.execute<RowDataPacket[]>(
      'SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ?',
      [limit]
    );

    return rows.map((row) => ({
      ...row,
      metadata: row.metadata
        ? (typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata)
        : null,
    })) as AuditLog[];
  }
}
