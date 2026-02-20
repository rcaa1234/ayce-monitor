import { getPool } from '../database/connection';
import { User, UserStatus } from '../types';
import { generateUUID } from '../utils/uuid';
import { RowDataPacket, ResultSetHeader } from 'mysql2';
import bcrypt from 'bcryptjs';

export class UserModel {
  /**
   * Create a new user
   */
  static async create(data: {
    email: string;
    name: string;
    line_user_id?: string;
    google_id?: string;
    status?: UserStatus;
  }): Promise<User> {
    const pool = getPool();
    const id = generateUUID();

    await pool.execute<ResultSetHeader>(
      `INSERT INTO users (id, email, name, line_user_id, google_id, status) VALUES (?, ?, ?, ?, ?, ?)`,
      [id, data.email, data.name, data.line_user_id || null, data.google_id || null, data.status || UserStatus.ACTIVE]
    );

    return this.findById(id) as Promise<User>;
  }

  /**
   * Find user by ID
   */
  static async findById(id: string): Promise<User | null> {
    const pool = getPool();

    const [rows] = await pool.execute<RowDataPacket[]>(
      'SELECT * FROM users WHERE id = ?',
      [id]
    );

    return rows[0] ? (rows[0] as User) : null;
  }

  /**
   * Find user by email
   */
  static async findByEmail(email: string): Promise<User | null> {
    const pool = getPool();

    const [rows] = await pool.execute<RowDataPacket[]>(
      'SELECT * FROM users WHERE email = ?',
      [email]
    );

    return rows[0] ? (rows[0] as User) : null;
  }

  /**
   * Find user by LINE user ID
   */
  static async findByLineUserId(lineUserId: string): Promise<User | null> {
    const pool = getPool();

    const [rows] = await pool.execute<RowDataPacket[]>(
      'SELECT * FROM users WHERE line_user_id = ?',
      [lineUserId]
    );

    return rows[0] ? (rows[0] as User) : null;
  }

  /**
   * Find user by Google ID
   */
  static async findByGoogleId(googleId: string): Promise<User | null> {
    const pool = getPool();

    const [rows] = await pool.execute<RowDataPacket[]>(
      'SELECT * FROM users WHERE google_id = ?',
      [googleId]
    );

    return rows[0] ? (rows[0] as User) : null;
  }

  /**
   * Get all users (for admin management)
   */
  static async findAll(): Promise<User[]> {
    const pool = getPool();

    const [rows] = await pool.execute<RowDataPacket[]>(
      'SELECT id, email, name, google_id, status, created_at, updated_at FROM users ORDER BY created_at DESC'
    );

    return rows as User[];
  }

  /**
   * Update user
   */
  static async update(id: string, data: Partial<User>): Promise<void> {
    const pool = getPool();
    const fields: string[] = [];
    const values: any[] = [];

    if (data.email !== undefined) {
      fields.push('email = ?');
      values.push(data.email);
    }
    if (data.name !== undefined) {
      fields.push('name = ?');
      values.push(data.name);
    }
    if (data.line_user_id !== undefined) {
      fields.push('line_user_id = ?');
      values.push(data.line_user_id);
    }
    if (data.google_id !== undefined) {
      fields.push('google_id = ?');
      values.push(data.google_id);
    }
    if (data.status !== undefined) {
      fields.push('status = ?');
      values.push(data.status);
    }

    if (fields.length === 0) return;

    values.push(id);

    await pool.execute(
      `UPDATE users SET ${fields.join(', ')} WHERE id = ?`,
      values
    );
  }

  /**
   * Get user roles
   */
  static async getRoles(userId: string): Promise<string[]> {
    const pool = getPool();

    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT r.name FROM roles r
       INNER JOIN user_roles ur ON r.id = ur.role_id
       WHERE ur.user_id = ?`,
      [userId]
    );

    return rows.map((row) => row.name);
  }

  /**
   * Assign role to user
   */
  static async assignRole(userId: string, roleName: string): Promise<void> {
    const pool = getPool();

    // Get role ID
    const [roleRows] = await pool.execute<RowDataPacket[]>(
      'SELECT id FROM roles WHERE name = ?',
      [roleName]
    );

    if (roleRows.length === 0) {
      throw new Error(`Role ${roleName} not found`);
    }

    const roleId = roleRows[0].id;

    await pool.execute(
      'INSERT IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)',
      [userId, roleId]
    );
  }

  /**
   * Set roles for user (replace all existing roles)
   */
  static async setRoles(userId: string, roleNames: string[]): Promise<void> {
    const pool = getPool();

    // Remove all existing roles
    await pool.execute('DELETE FROM user_roles WHERE user_id = ?', [userId]);

    // Assign new roles
    for (const roleName of roleNames) {
      await this.assignRole(userId, roleName);
    }
  }

  /**
   * Verify password
   */
  static async verifyPassword(password: string, passwordHash: string): Promise<boolean> {
    return bcrypt.compare(password, passwordHash);
  }
}
