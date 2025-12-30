import { getPool } from '../database/connection';
import { RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { generateUUID } from '../utils/uuid';

export type SettingType = 'STRING' | 'NUMBER' | 'BOOLEAN' | 'JSON';

export interface SystemSetting {
  id: string;
  setting_key: string;
  setting_value: string;
  setting_type: SettingType;
  description?: string;
  created_at: Date;
  updated_at: Date;
}

export interface ScheduleConfig {
  monday: { enabled: boolean; time: string };
  tuesday: { enabled: boolean; time: string };
  wednesday: { enabled: boolean; time: string };
  thursday: { enabled: boolean; time: string };
  friday: { enabled: boolean; time: string };
  saturday: { enabled: boolean; time: string };
  sunday: { enabled: boolean; time: string };
}

export class SettingsModel {
  /**
   * Get a setting by key
   */
  static async get(key: string): Promise<any> {
    const pool = getPool();
    const [rows] = await pool.execute<RowDataPacket[]>(
      'SELECT * FROM system_settings WHERE setting_key = ?',
      [key]
    );

    if (rows.length === 0) {
      return null;
    }

    const setting = rows[0] as SystemSetting;
    return this.parseValue(setting.setting_value, setting.setting_type);
  }

  /**
   * Get all settings
   */
  static async getAll(): Promise<Record<string, any>> {
    const pool = getPool();
    const [rows] = await pool.execute<RowDataPacket[]>(
      'SELECT * FROM system_settings ORDER BY setting_key'
    );

    const settings: Record<string, any> = {};
    for (const row of rows as SystemSetting[]) {
      settings[row.setting_key] = {
        value: this.parseValue(row.setting_value, row.setting_type),
        type: row.setting_type,
        description: row.description,
      };
    }

    return settings;
  }

  /**
   * Set a setting value
   */
  static async set(key: string, value: any, type: SettingType = 'STRING'): Promise<void> {
    const pool = getPool();
    const stringValue = this.stringifyValue(value, type);

    await pool.execute(
      `INSERT INTO system_settings (id, setting_key, setting_value, setting_type)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE setting_value = ?, updated_at = NOW()`,
      [generateUUID(), key, stringValue, type, stringValue]
    );
  }

  /**
   * Update multiple settings at once
   */
  static async updateMultiple(settings: Record<string, { value: any; type: SettingType }>): Promise<void> {
    const pool = getPool();
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      for (const [key, { value, type }] of Object.entries(settings)) {
        const stringValue = this.stringifyValue(value, type);
        await connection.execute(
          `INSERT INTO system_settings (id, setting_key, setting_value, setting_type)
           VALUES (?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE setting_value = ?, updated_at = NOW()`,
          [generateUUID(), key, stringValue, type, stringValue]
        );
      }

      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * Parse value based on type
   */
  private static parseValue(value: string, type: SettingType): any {
    switch (type) {
      case 'NUMBER':
        return parseFloat(value);
      case 'BOOLEAN':
        return value === 'true' || value === '1';
      case 'JSON':
        return JSON.parse(value);
      case 'STRING':
      default:
        return value;
    }
  }

  /**
   * Stringify value based on type
   */
  private static stringifyValue(value: any, type: SettingType): string {
    switch (type) {
      case 'JSON':
        return JSON.stringify(value);
      case 'BOOLEAN':
        return value ? 'true' : 'false';
      default:
        return String(value);
    }
  }
}
