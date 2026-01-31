/**
 * 危機預警服務
 * 負責偵測負面聲量突增和高互動負面內容
 */

import { getPool } from '../database/connection';
import { RowDataPacket } from 'mysql2';
import logger from '../utils/logger';
import { generateUUID } from '../utils/uuid';
import lineService from './line.service';

interface AlertConfig {
  brand_id: string;
  brand_name: string;
  baseline_days: number;
  trigger_multiplier: number;
  only_negative: boolean;
  high_engagement_threshold: number;
  cooldown_minutes: number;
}

interface SurgeAnalysis {
  current_count: number;
  baseline_avg: number;
  ratio: number;
  triggered: boolean;
  mention_ids: string[];
}

interface HighEngagementMention {
  id: string;
  title: string;
  url: string;
  score: number;
  sentiment: string;
}

class CrisisAlertService {
  /**
   * 取得所有啟用的警報配置
   */
  async getActiveConfigs(): Promise<AlertConfig[]> {
    const pool = getPool();

    const [rows] = await pool.execute<RowDataPacket[]>(`
      SELECT
        cac.brand_id,
        cac.baseline_days,
        cac.trigger_multiplier,
        cac.only_negative,
        cac.cooldown_minutes,
        mb.name as brand_name,
        COALESCE(cac.high_engagement_threshold, mb.engagement_threshold, 100) as effective_threshold
      FROM crisis_alert_config cac
      JOIN monitor_brands mb ON cac.brand_id = mb.id
      WHERE cac.alert_enabled = true AND mb.is_active = true
    `);

    return rows.map(row => ({
      brand_id: row.brand_id,
      brand_name: row.brand_name,
      baseline_days: row.baseline_days || 7,
      trigger_multiplier: parseFloat(row.trigger_multiplier) || 2.0,
      only_negative: row.only_negative !== false,
      high_engagement_threshold: row.effective_threshold || 100,
      cooldown_minutes: row.cooldown_minutes || 60,
    }));
  }

  /**
   * 為品牌建立預設配置（如果不存在）
   */
  async ensureConfigExists(brandId: string): Promise<void> {
    const pool = getPool();

    await pool.execute(`
      INSERT IGNORE INTO crisis_alert_config (id, brand_id)
      VALUES (?, ?)
    `, [generateUUID(), brandId]);
  }

  /**
   * 取得所有品牌並建立預設配置
   */
  async initializeConfigs(): Promise<void> {
    const pool = getPool();

    const [brands] = await pool.execute<RowDataPacket[]>(`
      SELECT id FROM monitor_brands WHERE is_active = true
    `);

    for (const brand of brands) {
      await this.ensureConfigExists(brand.id);
    }

    logger.info(`[CrisisAlert] Initialized configs for ${brands.length} brands`);
  }

  /**
   * 分析負面聲量突增
   */
  async analyzeNegativeSurge(config: AlertConfig): Promise<SurgeAnalysis> {
    const pool = getPool();

    // 今日負面提及數
    const [todayRows] = await pool.execute<RowDataPacket[]>(`
      SELECT id FROM monitor_mentions
      WHERE brand_id = ?
        AND DATE(discovered_at) = CURDATE()
        AND (sentiment = 'negative' OR primary_topic = 'pain_point')
    `, [config.brand_id]);

    const currentCount = todayRows.length;
    const mentionIds = todayRows.map(r => r.id);

    // 過去 N 天平均（排除今天）
    const [avgRows] = await pool.execute<RowDataPacket[]>(`
      SELECT COUNT(*) as total_count
      FROM monitor_mentions
      WHERE brand_id = ?
        AND discovered_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
        AND discovered_at < CURDATE()
        AND (sentiment = 'negative' OR primary_topic = 'pain_point')
    `, [config.brand_id, config.baseline_days]);

    const totalPastDays = avgRows[0]?.total_count || 0;
    const baselineAvg = totalPastDays / config.baseline_days;
    const ratio = baselineAvg > 0 ? currentCount / baselineAvg : (currentCount > 0 ? 999 : 0);

    // 觸發條件：比率 >= 倍數 且 至少有 3 筆
    const triggered = ratio >= config.trigger_multiplier && currentCount >= 3;

    return {
      current_count: currentCount,
      baseline_avg: baselineAvg,
      ratio,
      triggered,
      mention_ids: mentionIds,
    };
  }

  /**
   * 檢查高互動負面內容
   */
  async checkHighEngagementNegative(config: AlertConfig): Promise<{
    found: boolean;
    mentions: HighEngagementMention[];
  }> {
    const pool = getPool();

    // 查詢 24 小時內未警報過的高互動負面內容
    const [rows] = await pool.execute<RowDataPacket[]>(`
      SELECT
        mm.id,
        mm.title,
        mm.url,
        COALESCE(mm.engagement_score,
          (COALESCE(mm.likes_count, 0) + COALESCE(mm.comments_count, 0) * 2 + COALESCE(mm.shares_count, 0) * 3)
        ) as score,
        mm.sentiment
      FROM monitor_mentions mm
      WHERE mm.brand_id = ?
        AND mm.discovered_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
        AND (mm.sentiment = 'negative' OR mm.primary_topic = 'pain_point')
        AND COALESCE(mm.engagement_score,
          (COALESCE(mm.likes_count, 0) + COALESCE(mm.comments_count, 0) * 2 + COALESCE(mm.shares_count, 0) * 3)
        ) >= ?
        AND mm.id NOT IN (
          SELECT JSON_UNQUOTE(JSON_EXTRACT(cal.mention_ids, CONCAT('$[', n.n, ']')))
          FROM crisis_alert_logs cal
          CROSS JOIN (
            SELECT 0 as n UNION SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4
            UNION SELECT 5 UNION SELECT 6 UNION SELECT 7 UNION SELECT 8 UNION SELECT 9
          ) n
          WHERE cal.brand_id = ?
            AND cal.alert_type = 'high_engagement_negative'
            AND cal.created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
            AND JSON_UNQUOTE(JSON_EXTRACT(cal.mention_ids, CONCAT('$[', n.n, ']'))) IS NOT NULL
        )
      ORDER BY score DESC
      LIMIT 10
    `, [config.brand_id, config.high_engagement_threshold, config.brand_id]);

    return {
      found: rows.length > 0,
      mentions: rows.map(r => ({
        id: r.id,
        title: r.title || '(無標題)',
        url: r.url,
        score: r.score,
        sentiment: r.sentiment,
      })),
    };
  }

  /**
   * 檢查是否在冷卻期
   */
  async isInCooldown(brandId: string, alertType: string, cooldownMinutes: number): Promise<boolean> {
    const pool = getPool();

    const [rows] = await pool.execute<RowDataPacket[]>(`
      SELECT id FROM crisis_alert_logs
      WHERE brand_id = ? AND alert_type = ?
        AND created_at >= DATE_SUB(NOW(), INTERVAL ? MINUTE)
      LIMIT 1
    `, [brandId, alertType, cooldownMinutes]);

    return rows.length > 0;
  }

  /**
   * 取得 LINE User ID
   */
  async getLineUserId(): Promise<string | null> {
    const pool = getPool();

    const [settings] = await pool.execute<RowDataPacket[]>(
      'SELECT line_user_id FROM smart_schedule_config WHERE enabled = true LIMIT 1'
    );

    return settings[0]?.line_user_id || null;
  }

  /**
   * 發送負面聲量突增警報
   */
  async sendNegativeSurgeAlert(
    config: AlertConfig,
    analysis: SurgeAnalysis
  ): Promise<void> {
    const lineUserId = await this.getLineUserId();
    if (!lineUserId) {
      logger.warn('[CrisisAlert] No LINE user configured');
      return;
    }

    const message =
      `🚨 危機預警：負面聲量突增\n\n` +
      `📍 品牌：${config.brand_name}\n` +
      `📊 今日負面提及：${analysis.current_count} 篇\n` +
      `📈 過去 ${config.baseline_days} 天平均：${analysis.baseline_avg.toFixed(1)} 篇\n` +
      `⚠️ 突增倍數：${analysis.ratio.toFixed(1)}x\n\n` +
      `請立即檢視輿情系統了解詳情`;

    await lineService.sendNotification(lineUserId, message);

    // 記錄警報日誌
    const logId = generateUUID();
    const pool = getPool();
    await pool.execute(`
      INSERT INTO crisis_alert_logs
        (id, brand_id, alert_type, current_count, baseline_avg, trigger_ratio, mention_ids, notified, notified_at)
      VALUES (?, ?, 'negative_surge', ?, ?, ?, ?, true, NOW())
    `, [
      logId,
      config.brand_id,
      analysis.current_count,
      analysis.baseline_avg,
      analysis.ratio,
      JSON.stringify(analysis.mention_ids),
    ]);

    logger.info(`[CrisisAlert] Sent negative_surge alert for brand ${config.brand_name}`);
  }

  /**
   * 發送高互動負面內容警報
   */
  async sendHighEngagementAlert(
    config: AlertConfig,
    mentions: HighEngagementMention[]
  ): Promise<void> {
    const lineUserId = await this.getLineUserId();
    if (!lineUserId) {
      logger.warn('[CrisisAlert] No LINE user configured');
      return;
    }

    let message =
      `🔥 高互動負面內容警報\n\n` +
      `📍 品牌：${config.brand_name}\n` +
      `📢 發現 ${mentions.length} 篇高互動負面內容：\n\n`;

    mentions.slice(0, 3).forEach((m, i) => {
      const titlePreview = m.title.length > 30 ? m.title.substring(0, 30) + '...' : m.title;
      message += `${i + 1}. ${titlePreview}\n`;
      message += `   互動分數: ${m.score}\n`;
      message += `   🔗 ${m.url}\n\n`;
    });

    if (mentions.length > 3) {
      message += `... 還有 ${mentions.length - 3} 篇`;
    }

    await lineService.sendNotification(lineUserId, message);

    // 記錄警報日誌
    const logId = generateUUID();
    const pool = getPool();
    await pool.execute(`
      INSERT INTO crisis_alert_logs
        (id, brand_id, alert_type, current_count, baseline_avg, trigger_ratio, mention_ids, notified, notified_at)
      VALUES (?, ?, 'high_engagement_negative', ?, 0, 0, ?, true, NOW())
    `, [
      logId,
      config.brand_id,
      mentions.length,
      JSON.stringify(mentions.map(m => m.id)),
    ]);

    logger.info(`[CrisisAlert] Sent high_engagement_negative alert for brand ${config.brand_name}`);
  }

  /**
   * 執行危機預警檢查（排程任務入口）
   */
  async runCrisisCheck(): Promise<{
    checked: number;
    alerts: number;
  }> {
    logger.info('[CrisisAlert] Running crisis alert check...');

    // 確保所有品牌都有配置
    await this.initializeConfigs();

    const configs = await this.getActiveConfigs();
    let alertCount = 0;

    for (const config of configs) {
      try {
        // 1. 檢查負面聲量突增
        if (!await this.isInCooldown(config.brand_id, 'negative_surge', config.cooldown_minutes)) {
          const surgeAnalysis = await this.analyzeNegativeSurge(config);
          if (surgeAnalysis.triggered) {
            await this.sendNegativeSurgeAlert(config, surgeAnalysis);
            alertCount++;
          }
        }

        // 2. 檢查高互動負面內容
        if (!await this.isInCooldown(config.brand_id, 'high_engagement_negative', config.cooldown_minutes)) {
          const highEngCheck = await this.checkHighEngagementNegative(config);
          if (highEngCheck.found) {
            await this.sendHighEngagementAlert(config, highEngCheck.mentions);
            alertCount++;
          }
        }
      } catch (error) {
        logger.error(`[CrisisAlert] Error checking brand ${config.brand_name}:`, error);
      }
    }

    logger.info(`[CrisisAlert] Crisis alert check completed. Checked ${configs.length} brands, sent ${alertCount} alerts`);

    return {
      checked: configs.length,
      alerts: alertCount,
    };
  }

  /**
   * 取得警報日誌
   */
  async getAlertLogs(options: {
    brandId?: string;
    alertType?: string;
    status?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<{
    logs: any[];
    total: number;
  }> {
    const pool = getPool();
    const { brandId, alertType, status } = options;
    // 確保 limit 和 offset 是整數
    const limit = Math.max(1, Math.min(100, Math.floor(Number(options.limit) || 50)));
    const offset = Math.max(0, Math.floor(Number(options.offset) || 0));

    let whereClause = '1=1';
    const params: any[] = [];

    if (brandId) {
      whereClause += ' AND cal.brand_id = ?';
      params.push(brandId);
    }
    if (alertType) {
      whereClause += ' AND cal.alert_type = ?';
      params.push(alertType);
    }
    if (status) {
      whereClause += ' AND cal.status = ?';
      params.push(status);
    }

    // 取得總數
    const [countRows] = await pool.execute<RowDataPacket[]>(
      `SELECT COUNT(*) as total FROM crisis_alert_logs cal WHERE ${whereClause}`,
      params
    );
    const total = countRows[0]?.total || 0;

    // 取得日誌（LIMIT/OFFSET 使用字串插值避免 MySQL2 prepared statement 問題）
    const [logs] = await pool.execute<RowDataPacket[]>(
      `SELECT
        cal.*,
        mb.name as brand_name
      FROM crisis_alert_logs cal
      JOIN monitor_brands mb ON cal.brand_id = mb.id
      WHERE ${whereClause}
      ORDER BY cal.created_at DESC
      LIMIT ${limit} OFFSET ${offset}`,
      params
    );

    return { logs, total };
  }

  /**
   * 更新警報狀態
   */
  async updateAlertStatus(
    logId: string,
    status: 'acknowledged' | 'resolved' | 'ignored',
    userId?: string,
    notes?: string
  ): Promise<void> {
    const pool = getPool();

    await pool.execute(`
      UPDATE crisis_alert_logs
      SET status = ?,
          resolved_at = CASE WHEN ? IN ('resolved', 'ignored') THEN NOW() ELSE resolved_at END,
          resolved_by = CASE WHEN ? IN ('resolved', 'ignored') THEN ? ELSE resolved_by END,
          resolution_notes = COALESCE(?, resolution_notes)
      WHERE id = ?
    `, [status, status, status, userId, notes, logId]);

    logger.info(`[CrisisAlert] Updated alert ${logId} status to ${status}`);
  }

  /**
   * 取得配置
   */
  async getConfig(brandId: string): Promise<any> {
    const pool = getPool();

    const [rows] = await pool.execute<RowDataPacket[]>(`
      SELECT cac.*, mb.name as brand_name, mb.engagement_threshold as brand_engagement_threshold
      FROM crisis_alert_config cac
      JOIN monitor_brands mb ON cac.brand_id = mb.id
      WHERE cac.brand_id = ?
    `, [brandId]);

    return rows[0] || null;
  }

  /**
   * 更新配置
   */
  async updateConfig(brandId: string, updates: {
    baseline_days?: number;
    trigger_multiplier?: number;
    only_negative?: boolean;
    high_engagement_threshold?: number;
    alert_enabled?: boolean;
    cooldown_minutes?: number;
  }): Promise<void> {
    const pool = getPool();

    // 確保配置存在
    await this.ensureConfigExists(brandId);

    const fields: string[] = [];
    const values: any[] = [];

    if (updates.baseline_days !== undefined) {
      fields.push('baseline_days = ?');
      values.push(updates.baseline_days);
    }
    if (updates.trigger_multiplier !== undefined) {
      fields.push('trigger_multiplier = ?');
      values.push(updates.trigger_multiplier);
    }
    if (updates.only_negative !== undefined) {
      fields.push('only_negative = ?');
      values.push(updates.only_negative);
    }
    if (updates.high_engagement_threshold !== undefined) {
      fields.push('high_engagement_threshold = ?');
      values.push(updates.high_engagement_threshold);
    }
    if (updates.alert_enabled !== undefined) {
      fields.push('alert_enabled = ?');
      values.push(updates.alert_enabled);
    }
    if (updates.cooldown_minutes !== undefined) {
      fields.push('cooldown_minutes = ?');
      values.push(updates.cooldown_minutes);
    }

    if (fields.length > 0) {
      values.push(brandId);
      await pool.execute(
        `UPDATE crisis_alert_config SET ${fields.join(', ')} WHERE brand_id = ?`,
        values
      );
    }

    logger.info(`[CrisisAlert] Updated config for brand ${brandId}`);
  }
}

export default new CrisisAlertService();
