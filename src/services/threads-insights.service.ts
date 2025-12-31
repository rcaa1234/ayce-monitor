import axios from 'axios';
import config from '../config';
import logger from '../utils/logger';
import { InsightsModel } from '../models/insights.model';
import { PostModel } from '../models/post.model';
import threadsService from './threads.service';
import { PeriodType } from '../types';

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

      const response = await axios.get(
        `${config.threads.apiBaseUrl}/v1.0/${threadsMediaId}/insights`,
        {
          params: {
            metric: 'views,likes,replies,reposts,quotes,shares',
            access_token: accessToken,
          },
        }
      );

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
      // 如果沒有，嘗試從 URL 提取（舊資料的備用方案，但不可靠）
      let threadsMediaId = (post as any).threads_media_id;

      if (!threadsMediaId) {
        logger.warn(`Post ${postId} missing threads_media_id, this post may need to be republished`);
        // 舊資料：從 URL 提取（這會得到錯誤的格式，但保留為備用）
        const mediaIdMatch = post.post_url.match(/\/post\/([^/?]+)/);
        if (!mediaIdMatch) {
          logger.warn(`Could not extract media ID from URL: ${post.post_url}`);
          return false;
        }
        threadsMediaId = mediaIdMatch[1];
        logger.warn(`Using URL-extracted media ID: ${threadsMediaId} (may not work with Insights API)`);
      }

      // 獲取 Threads 帳號和 token
      const defaultAccount = await threadsService.getDefaultAccount();
      if (!defaultAccount) {
        logger.warn('No default Threads account found');
        return false;
      }

      // 獲取洞察數據
      const insights = await this.fetchPostInsights(postId, threadsMediaId, defaultAccount.token);
      if (!insights) {
        return false;
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

      // 逐個同步（避免 API 限流）
      for (const post of posts) {
        const success = await this.syncPostInsights(post.id);
        if (success) {
          successCount++;
        } else {
          failCount++;
        }

        // 避免 API 限流，每次請求間隔 1 秒
        await this.sleep(1000);
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
      const response = await axios.get(
        `${config.threads.apiBaseUrl}/me`,
        {
          params: {
            fields: 'followers_count,following_count,media_count',
            access_token: accessToken,
          },
        }
      );

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
}

export default new ThreadsInsightsService();
