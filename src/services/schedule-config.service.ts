/**
 * Schedule Config Service
 * 用途：管理 AI 自動發文的配置
 */

import { getPool } from '../database/connection';
import { RowDataPacket } from 'mysql2';
import logger from '../utils/logger';

/**
 * 排程配置結構
 */
export interface ScheduleConfig {
  auto_schedule_enabled: boolean;
  posts_per_day: number;
  threads_account_id?: string;
  line_user_id?: string;
  time_range_start?: string; // HH:MM:SS
  time_range_end?: string;   // HH:MM:SS
  active_days?: number[];    // 1=週一, 7=週日
  ai_prompt?: string;
  ai_engine?: string;
}

/**
 * 排程配置服務
 */
class ScheduleConfigService {
  /**
   * 取得排程配置
   * 如果資料庫中沒有配置，使用預設值
   */
  async getConfig(): Promise<ScheduleConfig> {
    const pool = getPool();

    try {
      const [rows] = await pool.execute<RowDataPacket[]>(
        'SELECT * FROM smart_schedule_config WHERE enabled = true LIMIT 1'
      );

      if (rows.length === 0) {
        // 返回預設配置
        return {
          auto_schedule_enabled: false,
          posts_per_day: 1,
          threads_account_id: undefined,
          line_user_id: undefined,
          time_range_start: '09:00:00',
          time_range_end: '21:00:00',
          active_days: [],
          ai_prompt: undefined,
          ai_engine: 'GPT5_2',
        };
      }

      const config = rows[0];
      return {
        auto_schedule_enabled: Boolean(config.auto_schedule_enabled),
        posts_per_day: parseInt(config.posts_per_day) || 1,
        threads_account_id: config.threads_account_id || undefined,
        line_user_id: config.line_user_id || undefined,
        time_range_start: config.time_range_start || '09:00:00',
        time_range_end: config.time_range_end || '21:00:00',
        active_days: config.active_days
          ? (typeof config.active_days === 'string' ? JSON.parse(config.active_days) : config.active_days)
          : [],
        ai_prompt: config.ai_prompt || undefined,
        ai_engine: config.ai_engine || 'GPT5_2',
      };
    } catch (error) {
      logger.error('Failed to get schedule config, using defaults:', error);
      return {
        auto_schedule_enabled: false,
        posts_per_day: 1,
        threads_account_id: undefined,
        line_user_id: undefined,
        time_range_start: '09:00:00',
        time_range_end: '21:00:00',
        active_days: [],
        ai_prompt: undefined,
        ai_engine: 'GPT5_2',
      };
    }
  }
}

export default new ScheduleConfigService();
