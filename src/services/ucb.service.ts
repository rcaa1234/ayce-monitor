/**
 * UCB (Upper Confidence Bound) 演算法服務
 * 用途：實作 UCB 策略,自動選擇最佳時段和模板組合
 * 影響：新增服務,不影響現有功能
 */

import { getPool } from '../database/connection';
import { RowDataPacket } from 'mysql2';
import logger from '../utils/logger';

/**
 * 模板資料結構
 */
interface Template {
  id: string;
  name: string;
  prompt: string;
  description: string | null;
  enabled: boolean;
  total_uses: number;
  total_views: number;
  total_engagement: number;
  avg_engagement_rate: number;
}

/**
 * 時段資料結構
 */
interface TimeSlot {
  id: string;
  name: string;
  start_hour: number;
  start_minute: number;
  end_hour: number;
  end_minute: number;
  allowed_template_ids: string[]; // JSON array
  active_days: number[]; // JSON array, 1=週一...7=週日
  enabled: boolean;
  priority: number;
}

/**
 * UCB 配置結構
 */
interface UCBConfig {
  exploration_factor: number; // 探索係數 (1.0-2.0)
  min_trials_per_template: number; // 最少試驗次數
  posts_per_day: number;
  auto_schedule_enabled: boolean;
  threads_account_id?: string; // Threads 發布帳號 ID
  line_user_id?: string; // LINE 通知接收者 User ID
  time_range_start?: string; // UCB 發文時段開始時間 (HH:MM:SS)
  time_range_end?: string; // UCB 發文時段結束時間 (HH:MM:SS)
  active_days?: number[]; // UCB 啟用星期 (1=週一...7=週日)
  ai_prompt?: string; // AI 發文提示詞
  ai_engine?: string; // AI 引擎
}

/**
 * UCB 分數計算結果
 */
interface UCBScore {
  template: Template;
  ucbScore: number;
  isExploration: boolean; // 是否為探索階段
  reason: string; // 選擇原因
}

/**
 * 選擇結果
 */
export interface SelectionResult {
  timeSlot: TimeSlot;
  template: Template;
  scheduledTime: Date;
  ucbScore: number;
  isExploration: boolean;
  reason: string;
}

/**
 * UCB 服務類別
 */
class UCBService {
  /**
   * 取得 UCB 配置
   * 如果資料庫中沒有配置,使用預設值
   */
  async getConfig(): Promise<UCBConfig> {
    const pool = getPool();

    try {
      const [rows] = await pool.execute<RowDataPacket[]>(
        'SELECT * FROM smart_schedule_config WHERE enabled = true LIMIT 1'
      );

      if (rows.length === 0) {
        // 返回預設配置
        return {
          exploration_factor: 1.5,
          min_trials_per_template: 5,
          posts_per_day: 1,
          auto_schedule_enabled: true,
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
        exploration_factor: parseFloat(config.exploration_factor),
        min_trials_per_template: parseInt(config.min_trials_per_template),
        posts_per_day: parseInt(config.posts_per_day),
        auto_schedule_enabled: Boolean(config.auto_schedule_enabled),
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
      logger.error('Failed to get UCB config, using defaults:', error);
      return {
        exploration_factor: 1.5,
        min_trials_per_template: 5,
        posts_per_day: 1,
        auto_schedule_enabled: true,
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

  /**
   * 取得所有啟用的時段
   * 按優先級排序
   */
  async getEnabledTimeSlots(): Promise<TimeSlot[]> {
    const pool = getPool();

    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT id, name, start_hour, start_minute, end_hour, end_minute,
              allowed_template_ids, active_days, enabled, priority
       FROM schedule_time_slots
       WHERE enabled = true
       ORDER BY priority DESC, start_hour ASC`
    );

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      start_hour: row.start_hour,
      start_minute: row.start_minute,
      end_hour: row.end_hour,
      end_minute: row.end_minute,
      allowed_template_ids: typeof row.allowed_template_ids === 'string'
        ? JSON.parse(row.allowed_template_ids)
        : row.allowed_template_ids,
      active_days: typeof row.active_days === 'string'
        ? JSON.parse(row.active_days)
        : row.active_days,
      enabled: Boolean(row.enabled),
      priority: row.priority,
    }));
  }

  /**
   * 取得所有啟用的模板
   */
  async getEnabledTemplates(): Promise<Template[]> {
    const pool = getPool();

    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT id, name, prompt, description, enabled,
              total_uses, total_views, total_engagement, avg_engagement_rate
       FROM content_templates
       WHERE enabled = true
       ORDER BY avg_engagement_rate DESC`
    );

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      prompt: row.prompt,
      description: row.description,
      enabled: Boolean(row.enabled),
      total_uses: row.total_uses,
      total_views: row.total_views,
      total_engagement: row.total_engagement,
      avg_engagement_rate: parseFloat(row.avg_engagement_rate),
    }));
  }

  /**
   * 選擇今天最適合的時段
   * 根據目前是星期幾和時段的優先級
   */
  selectBestTimeSlot(timeSlots: TimeSlot[], targetDate: Date): TimeSlot | null {
    const dayOfWeek = targetDate.getDay(); // 0=週日, 1=週一, ..., 6=週六
    const adjustedDay = dayOfWeek === 0 ? 7 : dayOfWeek; // 轉換為 1=週一...7=週日

    // 過濾出今天活躍的時段
    const activeToday = timeSlots.filter((slot) => slot.active_days.includes(adjustedDay));

    if (activeToday.length === 0) {
      return null;
    }

    // 返回優先級最高的時段 (已按 priority DESC 排序)
    return activeToday[0];
  }

  /**
   * 取得總發文數 (用於 UCB 計算)
   */
  async getTotalPostsCount(): Promise<number> {
    const pool = getPool();

    const [rows] = await pool.execute<RowDataPacket[]>('SELECT COUNT(*) as total FROM posts WHERE status = "POSTED"');

    return rows[0].total || 0;
  }

  /**
   * 計算單個模板的 UCB 分數
   * 公式：UCB = 平均互動率 + exploration_factor × √(ln(總發文數) / 該模板使用次數)
   */
  calculateUCB(template: Template, totalPosts: number, config: UCBConfig): UCBScore {
    // 如果使用次數不足,給予高優先級 (探索階段)
    if (template.total_uses < config.min_trials_per_template) {
      return {
        template,
        ucbScore: 999 + Math.random(), // 隨機化避免固定順序
        isExploration: true,
        reason: `探索階段：該模板使用次數不足 (${template.total_uses}/${config.min_trials_per_template})`,
      };
    }

    // 如果還沒有發文,避免除以零
    if (totalPosts === 0) {
      return {
        template,
        ucbScore: Math.random(),
        isExploration: true,
        reason: '系統初始化：尚無發文記錄',
      };
    }

    // 計算平均互動率 (已經是百分比,歸一化到 0-1)
    const avgRate = template.avg_engagement_rate / 100;

    // 計算探索獎勵
    const explorationBonus =
      config.exploration_factor * Math.sqrt(Math.log(totalPosts) / Math.max(template.total_uses, 1));

    const ucbScore = avgRate + explorationBonus;

    return {
      template,
      ucbScore,
      isExploration: false,
      reason: `UCB選擇：互動率=${template.avg_engagement_rate.toFixed(2)}%, 探索獎勵=${explorationBonus.toFixed(4)}, 總分=${ucbScore.toFixed(4)}`,
    };
  }

  /**
   * 為時段內的所有模板計算 UCB 分數並選擇最佳模板
   */
  async selectBestTemplate(timeSlot: TimeSlot): Promise<UCBScore | null> {
    const config = await this.getConfig();
    const allTemplates = await this.getEnabledTemplates();
    const totalPosts = await getTotalPostsCount();

    // 過濾出該時段允許的模板
    const allowedTemplates = allTemplates.filter((t) => timeSlot.allowed_template_ids.includes(t.id));

    if (allowedTemplates.length === 0) {
      logger.warn(`Time slot ${timeSlot.name} has no allowed templates`);
      return null;
    }

    // 計算每個模板的 UCB 分數
    const scores = allowedTemplates.map((template) => this.calculateUCB(template, totalPosts, config));

    // 按 UCB 分數排序,選擇最高分
    scores.sort((a, b) => b.ucbScore - a.ucbScore);

    return scores[0];
  }

  /**
   * 在時段內隨機選擇一個發文時間
   */
  generateRandomTime(timeSlot: TimeSlot, targetDate: Date): Date {
    const startMinutes = timeSlot.start_hour * 60 + timeSlot.start_minute;
    const endMinutes = timeSlot.end_hour * 60 + timeSlot.end_minute;

    // 在時段內隨機選擇分鐘數
    const randomMinutes = Math.floor(Math.random() * (endMinutes - startMinutes)) + startMinutes;

    const hour = Math.floor(randomMinutes / 60);
    const minute = randomMinutes % 60;

    // 使用目標日期的年月日（本地時間），搭配隨機產生的時分
    // 用戶設定的時間是台灣時間（UTC+8），所以需要用 UTC 方法來正確處理
    const year = targetDate.getFullYear();
    const month = targetDate.getMonth();
    const day = targetDate.getDate();

    // 建立本地時間，然後轉換為 UTC
    // 方法：先建立一個代表本地時間的字串，再解析為 Date
    // 這樣可以確保儲存的 UTC 時間正確對應到用戶期望的本地時間
    const localTimeStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+08:00`;
    const scheduledTime = new Date(localTimeStr);

    // Debug logging
    logger.info(`[UCB Time Debug] generateRandomTime: timeSlot=${timeSlot.start_hour}:${timeSlot.start_minute} - ${timeSlot.end_hour}:${timeSlot.end_minute}`);
    logger.info(`[UCB Time Debug] generateRandomTime: startMinutes=${startMinutes}, endMinutes=${endMinutes}, randomMinutes=${randomMinutes}`);
    logger.info(`[UCB Time Debug] generateRandomTime: localTimeStr=${localTimeStr}`);
    logger.info(`[UCB Time Debug] generateRandomTime: result=${hour}:${minute}, scheduledTime=${scheduledTime.toISOString()}`);

    return scheduledTime;
  }

  /**
   * 主要功能：為指定日期自動選擇最佳時段和模板組合
   * 使用 UCB 演算法
   */
  async selectOptimalSchedule(targetDate: Date): Promise<SelectionResult | null> {
    try {
      // 1. 從配置取得時間範圍，建立一個簡單的時段
      const config = await this.getConfig();
      const timeRangeStart = config.time_range_start || '09:00:00';
      const timeRangeEnd = config.time_range_end || '21:00:00';

      // 解析時間（支援 HH:MM 和 HH:MM:SS 格式）
      const startParts = timeRangeStart.split(':').map(Number);
      const endParts = timeRangeEnd.split(':').map(Number);
      const startHour = startParts[0] || 0;
      const startMinute = startParts[1] || 0;
      const endHour = endParts[0] || 0;
      const endMinute = endParts[1] || 0;

      // Debug logging
      logger.info(`[UCB Time Debug] Raw config: time_range_start='${config.time_range_start}', time_range_end='${config.time_range_end}'`);
      logger.info(`[UCB Time Debug] Parsed: start=${startHour}:${startMinute}, end=${endHour}:${endMinute}`);
      logger.info(`[UCB Time Debug] Target date: ${targetDate.toISOString()}`);

      // 先取得所有啟用的模板 ID，用於建立虛擬時段
      const allTemplates = await this.getEnabledTemplates();
      if (allTemplates.length === 0) {
        logger.warn('No enabled templates found for UCB scheduling');
        return null;
      }
      const allTemplateIds = allTemplates.map(t => t.id);
      logger.info(`UCB found ${allTemplates.length} enabled templates: ${allTemplates.map(t => t.name).join(', ')}`);

      // 建立虛擬時段（不需要從資料庫讀取）
      const timeSlot: TimeSlot = {
        id: 'ucb-auto-slot',
        name: 'UCB 自動時段',
        start_hour: startHour,
        start_minute: startMinute,
        end_hour: endHour,
        end_minute: endMinute,
        allowed_template_ids: allTemplateIds, // 使用所有啟用模板的 ID
        active_days: [], // 不在這裡檢查，在 scheduler 檢查
        enabled: true,
        priority: 0,
      };

      // 2. 使用 UCB 選擇最佳模板
      const bestTemplateScore = await this.selectBestTemplate(timeSlot);

      if (!bestTemplateScore) {
        logger.warn('No valid template found for UCB scheduling');
        return null;
      }

      // 3. 在時段內隨機選擇發文時間
      const scheduledTime = this.generateRandomTime(timeSlot, targetDate);

      logger.info(`UCB selected: ${bestTemplateScore.template.name} at ${scheduledTime.toISOString()}`);

      return {
        timeSlot,
        template: bestTemplateScore.template,
        scheduledTime,
        ucbScore: bestTemplateScore.ucbScore,
        isExploration: bestTemplateScore.isExploration,
        reason: bestTemplateScore.reason,
      };
    } catch (error) {
      logger.error('Failed to select optimal schedule:', error);
      return null;
    }
  }
}

// 匯出單例
export const ucbService = new UCBService();

// 匯出輔助函數 (用於測試或其他服務)
export async function getTotalPostsCount(): Promise<number> {
  const pool = getPool();
  const [rows] = await pool.execute<RowDataPacket[]>('SELECT COUNT(*) as total FROM posts WHERE status = "POSTED"');
  return rows[0].total || 0;
}
