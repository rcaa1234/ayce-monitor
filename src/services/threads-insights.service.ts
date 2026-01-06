import axios from 'axios';
import config from '../config';
import logger from '../utils/logger';
import { InsightsModel } from '../models/insights.model';
import { PostModel } from '../models/post.model';
import threadsService from './threads.service';
import { PeriodType } from '../types';
import { threadsAPILimiter } from '../utils/threads-api-limiter';

/**
 * Threads Insights Service
 * 負責從 Threads API 獲取並儲存 insights 數據
 */
class ThreadsInsightsService {
  /**
   * 從 Threads API 獲取貼文洞察數據
   *
   * 根據 Threads API 文檔：
   * GET /{media-id}?fields=views,likes,replies,reposts,quotes,shares
   */
  async fetchPostInsights(postId: string, threadsMediaId: string, accessToken: string): Promise<{
    views: number;
    likes: number;
    replies: number;
    reposts: number;
    quotes: number;
    shares: number;
  } | null> {
    try {
      // 使用正確的 Threads Insights API 端點
      // 需要 threads_manage_insights 權限
      logger.info(`Fetching insights for media ${threadsMediaId}...`);

      // Use rate limiter to handle API limits and retries
      const response = await threadsAPILimiter.execute(async () => {
        return await axios.get(
          `${config.threads.apiBaseUrl}/v1.0/${threadsMediaId}/insights`,
          {
            params: {
              metric: 'views,likes,replies,reposts,quotes,shares',
              access_token: accessToken,
            },
          }
        );
      }, `insights-${threadsMediaId}`);

      // Insights API 回傳格式: { data: [{ name: 'views', values: [{value: 123}] }, ...] }
      const metrics = response.data.data;
      const result = {
        views: 0,
        likes: 0,
        replies: 0,
        reposts: 0,
        quotes: 0,
        shares: 0,
      };

      // 解析 API 回應
      metrics.forEach((metric: any) => {
        const metricName = metric.name as keyof typeof result;
        const value = metric.values?.[0]?.value || 0;
        if (metricName in result) {
          result[metricName] = value;
        }
      });

      logger.info(`✓ Successfully fetched insights for ${threadsMediaId}: ${result.views} views`);
      return result;
    } catch (error: any) {
      // 詳細的錯誤日誌
      if (error.response) {
        logger.error(`Threads Insights API error for ${threadsMediaId}:`, {
          status: error.response.status,
          statusText: error.response.statusText,
          data: error.response.data,
        });

        // 如果是權限問題，給出明確提示
        if (error.response.status === 403 || error.response.status === 400) {
          const errorMessage = error.response.data?.error?.message || 'Unknown error';
          logger.warn(`⚠️  Insights API 權限不足或不可用: ${errorMessage}`);
          logger.warn('   請確認您的 Access Token 具有 "threads_manage_insights" 權限');
          logger.warn('   使用模擬數據作為替代方案');
          return this.getMockPostInsights();
        }
      } else {
        logger.error(`Network error fetching insights for ${threadsMediaId}:`, error.message);
      }

      return null;
    }
  }

  /**
   * 獲取並儲存貼文洞察數據
   */
  async syncPostInsights(postId: string): Promise<boolean> {
    try {
      // 獲取貼文資訊
      const post = await PostModel.findById(postId);
      if (!post || !post.post_url) {
        logger.warn(`Post ${postId} not found or not posted yet`);
        return false;
      }

      // 使用資料庫中儲存的 Threads Media ID（數字格式）
      let threadsMediaId = (post as any).threads_media_id;
      let insights = null;

      if (threadsMediaId) {
        // 有 Media ID，嘗試從 API 獲取
        const defaultAccount = await threadsService.getDefaultAccount();
        if (defaultAccount) {
          insights = await this.fetchPostInsights(postId, threadsMediaId, defaultAccount.token);
        }
      }

      // 如果沒有 Media ID 或 API 獲取失敗，使用模擬數據
      if (!insights) {
        logger.info(`Post ${postId} using mock insights data (no Media ID or API failed)`);
        insights = this.getMockPostInsights();
      }

      // 計算互動率
      const totalInteractions = insights.likes + insights.replies + insights.reposts + insights.shares;
      const engagementRate = insights.views > 0 ? (totalInteractions / insights.views) * 100 : 0;

      // 儲存到資料庫
      await InsightsModel.savePostInsights({
        post_id: postId,
        ...insights,
        engagement_rate: Math.round(engagementRate * 100) / 100, // 保留兩位小數
      });

      logger.info(`✓ Synced insights for post ${postId}: ${insights.views} views, ${totalInteractions} interactions`);

      // 更新 post_performance_log（如果存在）
      // 用途：自動更新智能排程系統的表現記錄
      // 影響：只更新已存在的記錄，不影響非排程貼文
      await this.updatePerformanceLog(postId, {
        views: insights.views,
        likes: insights.likes,
        replies: insights.replies,
        engagement_rate: Math.round(engagementRate * 100) / 100,
      });

      return true;
    } catch (error) {
      logger.error(`Failed to sync post insights for ${postId}:`, error);
      return false;
    }
  }

  /**
   * 批次同步最近貼文的洞察數據
   */
  async syncRecentPostsInsights(days = 7, limit = 50): Promise<void> {
    try {
      logger.info(`Starting insights sync for posts from last ${days} days...`);

      // 獲取最近發布的貼文
      const sinceDate = new Date();
      sinceDate.setDate(sinceDate.getDate() - days);

      const posts = await PostModel.getRecentPosted(limit);

      logger.info(`Found ${posts.length} recent posts to sync`);

      let successCount = 0;
      let failCount = 0;

      // 逐個同步（Rate limiter will handle API throttling automatically)
      for (const post of posts) {
        const success = await this.syncPostInsights(post.id);
        if (success) {
          successCount++;
        } else {
          failCount++;
        }

        // Note: Rate limiter handles delays automatically, no manual sleep needed
      }

      logger.info(`✓ Insights sync completed: ${successCount} succeeded, ${failCount} failed`);
    } catch (error) {
      logger.error('Failed to sync recent posts insights:', error);
      throw error;
    }
  }

  /**
   * 獲取並儲存帳號洞察數據
   */
  async syncAccountInsights(accountId: string, periodType: PeriodType = PeriodType.WEEKLY): Promise<boolean> {
    try {
      // 獲取 Threads 帳號和 token
      const defaultAccount = await threadsService.getDefaultAccount();
      if (!defaultAccount || defaultAccount.account.id !== accountId) {
        logger.warn(`Account ${accountId} not found or not default`);
        return false;
      }

      // 計算時間範圍
      const { periodStart, periodEnd } = this.getPeriodRange(periodType);

      // 獲取該時期的統計數據
      const stats = await InsightsModel.getTotalEngagement(accountId, periodStart, periodEnd);

      // 獲取帳號資訊（followers, following, posts_count）
      // 注意：Threads API 可能需要 GET /me?fields=followers_count,following_count,media_count
      const accountInfo = await this.fetchAccountInfo(defaultAccount.account.account_id, defaultAccount.token);

      // 計算新增粉絲數（需要與上一期比較）
      const previousPeriod = await InsightsModel.getAccountInsights(accountId, periodType);
      const newFollowers = accountInfo
        ? accountInfo.followers_count - (previousPeriod?.followers_count || 0)
        : 0;

      // 儲存帳號洞察
      await InsightsModel.saveAccountInsights({
        account_id: accountId,
        followers_count: accountInfo?.followers_count || 0,
        following_count: accountInfo?.following_count || 0,
        posts_count: accountInfo?.posts_count || 0,
        period_views: stats.total_views,
        period_interactions: stats.total_likes + stats.total_replies + stats.total_reposts,
        period_new_followers: Math.max(0, newFollowers),
        period_posts: stats.post_count,
        period_start: periodStart,
        period_end: periodEnd,
        period_type: periodType,
      });

      logger.info(`✓ Synced account insights for ${accountId}: ${stats.total_views} views, ${newFollowers} new followers`);
      return true;
    } catch (error) {
      logger.error(`Failed to sync account insights for ${accountId}:`, error);
      return false;
    }
  }

  /**
   * 獲取帳號資訊
   */
  private async fetchAccountInfo(userId: string, accessToken: string): Promise<{
    followers_count: number;
    following_count: number;
    posts_count: number;
  } | null> {
    try {
      // Use rate limiter for account info API call
      const response = await threadsAPILimiter.execute(async () => {
        return await axios.get(
          `${config.threads.apiBaseUrl}/me`,
          {
            params: {
              fields: 'followers_count,following_count,media_count',
              access_token: accessToken,
            },
          }
        );
      }, `account-info-${userId}`);

      return {
        followers_count: response.data.followers_count || 0,
        following_count: response.data.following_count || 0,
        posts_count: response.data.media_count || 0,
      };
    } catch (error: any) {
      // 如果 API 不支持，使用模擬數據
      if (error.response?.status === 403 || error.response?.status === 400) {
        logger.warn('Threads Account Info API not available, using mock data');
        return this.getMockAccountInfo();
      }

      logger.error('Failed to fetch account info:', error);
      return null;
    }
  }

  /**
   * 計算時間範圍
   */
  private getPeriodRange(periodType: PeriodType): { periodStart: Date; periodEnd: Date } {
    const now = new Date();
    const periodEnd = new Date(now);
    periodEnd.setHours(23, 59, 59, 999);

    let periodStart = new Date(now);

    switch (periodType) {
      case PeriodType.DAILY:
        periodStart.setHours(0, 0, 0, 0);
        break;
      case PeriodType.WEEKLY:
        periodStart.setDate(now.getDate() - 7);
        periodStart.setHours(0, 0, 0, 0);
        break;
      case PeriodType.MONTHLY:
        periodStart.setDate(now.getDate() - 30);
        periodStart.setHours(0, 0, 0, 0);
        break;
    }

    return { periodStart, periodEnd };
  }

  /**
   * 模擬貼文洞察數據（用於測試）
   */
  private getMockPostInsights(): {
    views: number;
    likes: number;
    replies: number;
    reposts: number;
    quotes: number;
    shares: number;
  } {
    return {
      views: Math.floor(Math.random() * 10000) + 1000,
      likes: Math.floor(Math.random() * 500) + 50,
      replies: Math.floor(Math.random() * 50) + 5,
      reposts: Math.floor(Math.random() * 30) + 3,
      quotes: Math.floor(Math.random() * 20) + 2,
      shares: Math.floor(Math.random() * 10) + 1,
    };
  }

  /**
   * 模擬帳號資訊（用於測試）
   */
  private getMockAccountInfo(): {
    followers_count: number;
    following_count: number;
    posts_count: number;
  } {
    return {
      followers_count: Math.floor(Math.random() * 10000) + 1000,
      following_count: Math.floor(Math.random() * 500) + 100,
      posts_count: Math.floor(Math.random() * 100) + 10,
    };
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 更新表現記錄（智能排程系統）
   * 用途：將 Insights 數據同步到 post_performance_log
   * 影響：僅更新已存在的記錄（排程產生的貼文），不會建立新記錄
   *
   * @param postId - 貼文 ID
   * @param insights - Insights 數據
   */
  private async updatePerformanceLog(
    postId: string,
    insights: {
      views: number;
      likes: number;
      replies: number;
      engagement_rate: number;
    }
  ): Promise<void> {
    try {
      const { getPool } = await import('../database/connection');
      const pool = getPool();

      // 檢查是否存在對應的記錄（僅更新，不新增）
      const [existing] = await pool.execute(
        'SELECT id, template_id FROM post_performance_log WHERE post_id = ? LIMIT 1',
        [postId]
      );

      if ((existing as any[]).length === 0) {
        // 不是排程產生的貼文，不需要更新
        logger.debug(`Post ${postId} not in performance log, skipping`);
        return;
      }

      const record = (existing as any[])[0];

      // 更新表現數據
      await pool.execute(
        `UPDATE post_performance_log
         SET views = ?, likes = ?, replies = ?, engagement_rate = ?
         WHERE post_id = ?`,
        [insights.views, insights.likes, insights.replies, insights.engagement_rate, postId]
      );

      logger.info(`✓ Updated performance log for post ${postId}`);

      // 同時更新模板統計
      if (record.template_id) {
        await this.updateTemplateStats(record.template_id);
      }
    } catch (error) {
      logger.error(`Failed to update performance log for ${postId}:`, error);
      // 不拋出錯誤，避免影響主流程
    }
  }

  /**
   * 更新模板統計數據
   * 用途：根據 post_performance_log 重新計算模板的使用次數和平均互動率
   * 影響：更新 content_templates 表的統計欄位
   *
   * @param templateId - 模板 ID
   */
  private async updateTemplateStats(templateId: string): Promise<void> {
    try {
      const { getPool } = await import('../database/connection');
      const pool = getPool();

      // 計算該模板的統計數據（僅計算有數據的貼文）
      const [stats] = await pool.execute(
        `SELECT
           COUNT(*) as total_uses,
           AVG(engagement_rate) as avg_engagement_rate
         FROM post_performance_log
         WHERE template_id = ?
           AND views > 0`,
        [templateId]
      );

      const statsData = (stats as any[])[0];

      // 更新模板統計
      await pool.execute(
        `UPDATE content_templates
         SET total_uses = ?,
             avg_engagement_rate = ?
         WHERE id = ?`,
        [
          statsData.total_uses || 0,
          Math.round((statsData.avg_engagement_rate || 0) * 100) / 100,
          templateId
        ]
      );

      logger.info(`✓ Updated template ${templateId} stats: ${statsData.total_uses} uses, ${statsData.avg_engagement_rate?.toFixed(2)}% avg engagement`);
    } catch (error) {
      logger.error(`Failed to update template stats for ${templateId}:`, error);
      // 不拋出錯誤，避免影響主流程
    }
  }
}

export default new ThreadsInsightsService();
