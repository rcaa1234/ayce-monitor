/**
 * 內容推薦引擎服務
 * 從 monitor_mentions 提取熱門話題，結合 AI 分析產出內容建議
 */

import { getPool } from '../database/connection';
import { RowDataPacket } from 'mysql2';
import logger from '../utils/logger';
import { generateUUID } from '../utils/uuid';
import aiService from './ai.service';
import { EngineType } from '../types';
import lineService from './line.service';

interface BrandProfile {
  id: string;
  name: string;
  industry: string;
  products: string[];
  product_keywords: string[];
  target_audience: any;
  age_range: string;
  relevant_topics: string[];
  topic_exclusions: string[];
  tone_style: string;
  content_taboos: string[];
}

interface TopicCluster {
  keywords: string[];
  mentions: Array<{
    id: string;
    title: string;
    content: string;
    engagement_score: number;
    url: string;
  }>;
  totalEngagement: number;
}

interface TopicAnalysis {
  relevanceScore: number;
  relevanceReason: string;
  contentAngle: string;
  suggestedHooks: string[];
}

interface PerformanceData {
  topPosts: Array<{
    content: string;
    views: number;
    likes: number;
    replies: number;
    engagement_rate: number;
  }>;
  avgEngagement: number;
  bestHours: number[];
}

class ContentRecommendationService {
  /**
   * 取得品牌 Profile
   */
  async getBrandProfile(): Promise<BrandProfile | null> {
    const pool = getPool();

    const [rows] = await pool.execute<RowDataPacket[]>(
      'SELECT * FROM brand_profiles WHERE is_active = true LIMIT 1'
    );

    if (rows.length === 0) return null;

    const row = rows[0];
    return {
      id: row.id,
      name: row.name,
      industry: row.industry,
      products: this.parseJSON(row.products, []),
      product_keywords: this.parseJSON(row.product_keywords, []),
      target_audience: this.parseJSON(row.target_audience, {}),
      age_range: row.age_range,
      relevant_topics: this.parseJSON(row.relevant_topics, []),
      topic_exclusions: this.parseJSON(row.topic_exclusions, []),
      tone_style: row.tone_style || '',
      content_taboos: this.parseJSON(row.content_taboos, []),
    };
  }

  /**
   * 更新品牌 Profile
   */
  async updateBrandProfile(updates: Partial<BrandProfile>): Promise<void> {
    const pool = getPool();

    const fields: string[] = [];
    const values: any[] = [];

    if (updates.name !== undefined) {
      fields.push('name = ?');
      values.push(updates.name);
    }
    if (updates.industry !== undefined) {
      fields.push('industry = ?');
      values.push(updates.industry);
    }
    if (updates.products !== undefined) {
      fields.push('products = ?');
      values.push(JSON.stringify(updates.products));
    }
    if (updates.product_keywords !== undefined) {
      fields.push('product_keywords = ?');
      values.push(JSON.stringify(updates.product_keywords));
    }
    if (updates.target_audience !== undefined) {
      fields.push('target_audience = ?');
      values.push(JSON.stringify(updates.target_audience));
    }
    if (updates.age_range !== undefined) {
      fields.push('age_range = ?');
      values.push(updates.age_range);
    }
    if (updates.relevant_topics !== undefined) {
      fields.push('relevant_topics = ?');
      values.push(JSON.stringify(updates.relevant_topics));
    }
    if (updates.topic_exclusions !== undefined) {
      fields.push('topic_exclusions = ?');
      values.push(JSON.stringify(updates.topic_exclusions));
    }
    if (updates.tone_style !== undefined) {
      fields.push('tone_style = ?');
      values.push(updates.tone_style);
    }
    if (updates.content_taboos !== undefined) {
      fields.push('content_taboos = ?');
      values.push(JSON.stringify(updates.content_taboos));
    }

    if (fields.length > 0) {
      await pool.execute(
        `UPDATE brand_profiles SET ${fields.join(', ')} WHERE is_active = true`,
        values
      );
    }

    logger.info('[ContentRecommendation] Updated brand profile');
  }

  /**
   * 解析 JSON 字串
   */
  private parseJSON<T>(value: any, defaultValue: T): T {
    if (!value) return defaultValue;
    if (typeof value === 'object') return value as T;
    try {
      return JSON.parse(value);
    } catch {
      return defaultValue;
    }
  }

  /**
   * 提取熱門話題叢集
   * 從最近 N 天的 monitor_mentions 中分析
   */
  async extractTopicClusters(days: number = 7, minMentions: number = 2): Promise<TopicCluster[]> {
    const pool = getPool();

    // 取得最近 N 天的提及
    const [mentions] = await pool.execute<RowDataPacket[]>(`
      SELECT
        id, title, content, url, matched_keywords,
        COALESCE(engagement_score,
          (COALESCE(likes_count, 0) + COALESCE(comments_count, 0) * 2 + COALESCE(shares_count, 0) * 3)
        ) as engagement_score
      FROM monitor_mentions
      WHERE discovered_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
        AND (title IS NOT NULL OR content IS NOT NULL)
      ORDER BY engagement_score DESC
      LIMIT 200
    `, [days]);

    // 按主題模式分群
    const clusterMap = new Map<string, TopicCluster>();

    // 話題模式
    const topicPatterns: { pattern: RegExp; name: string }[] = [
      { pattern: /推薦|求推|請推/, name: '推薦請求' },
      { pattern: /心得|開箱|評測/, name: '心得分享' },
      { pattern: /第一次|新手|入門/, name: '新手問題' },
      { pattern: /比較|選擇|哪個/, name: '比較選擇' },
      { pattern: /問題|困擾|怎麼辦/, name: '問題求助' },
      { pattern: /分享|經驗|教學/, name: '經驗分享' },
      { pattern: /雷|不推|踩雷|失望/, name: '負面評價' },
      { pattern: /好用|讚|推|CP值/, name: '正面評價' },
    ];

    for (const mention of mentions) {
      const title = mention.title || '';
      const content = mention.content?.substring(0, 200) || '';
      const text = `${title} ${content}`;

      // 獲取匹配的關鍵字
      const keywords = this.parseJSON<string[]>(mention.matched_keywords, []);

      // 找出符合的話題模式
      let clusterKey = 'general';
      for (const { pattern, name } of topicPatterns) {
        if (pattern.test(text)) {
          clusterKey = name;
          break;
        }
      }

      if (!clusterMap.has(clusterKey)) {
        clusterMap.set(clusterKey, {
          keywords: [],
          mentions: [],
          totalEngagement: 0,
        });
      }

      const cluster = clusterMap.get(clusterKey)!;
      cluster.keywords = [...new Set([...cluster.keywords, ...keywords])].slice(0, 10);
      cluster.mentions.push({
        id: mention.id,
        title: mention.title || '',
        content: mention.content?.substring(0, 200) || '',
        engagement_score: mention.engagement_score || 0,
        url: mention.url,
      });
      cluster.totalEngagement += mention.engagement_score || 0;
    }

    // 過濾並排序
    return Array.from(clusterMap.entries())
      .filter(([_, c]) => c.mentions.length >= minMentions)
      .sort((a, b) => b[1].totalEngagement - a[1].totalEngagement)
      .map(([name, cluster]) => ({
        ...cluster,
        keywords: [name, ...cluster.keywords].slice(0, 10),
      }))
      .slice(0, 10);
  }

  /**
   * 用 AI 分析話題相關性
   */
  async analyzeTopicRelevance(
    cluster: TopicCluster,
    profile: BrandProfile
  ): Promise<TopicAnalysis> {
    const prompt = `分析以下社群話題與品牌的相關性：

【品牌資訊】
- 產業：${profile.industry}
- 產品：${profile.products.join('、')}
- 目標客群：${profile.age_range}歲，${JSON.stringify(profile.target_audience)}
- 相關話題範圍：${profile.relevant_topics.join('、')}

【話題資訊】
- 關鍵詞：${cluster.keywords.join('、')}
- 提及次數：${cluster.mentions.length}
- 總互動分數：${cluster.totalEngagement}
- 代表性標題：
${cluster.mentions.slice(0, 5).map(m => `  - ${m.title}`).join('\n')}

請分析並回傳 JSON（只回傳 JSON，不要其他文字）：
{
  "relevance_score": 0.0到1.0的相關性分數,
  "relevance_reason": "相關性判斷理由（一句話）",
  "content_angle": "建議的內容切入角度（一句話）",
  "suggested_hooks": ["開頭句式1", "開頭句式2", "開頭句式3"]
}`;

    try {
      const result = await aiService.generateContent({
        engine: EngineType.GPT4O_MINI,
        systemPrompt: '你是一位專業的社群行銷分析師。請以 JSON 格式回覆，不要包含 markdown 標記。',
        stylePreset: prompt,
        maxTokens: 800,
      });

      // 嘗試解析 JSON
      const jsonMatch = result.text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          relevanceScore: Math.min(1, Math.max(0, parsed.relevance_score || 0)),
          relevanceReason: parsed.relevance_reason || '',
          contentAngle: parsed.content_angle || '',
          suggestedHooks: parsed.suggested_hooks || [],
        };
      }
    } catch (error) {
      logger.error('[ContentRecommendation] AI analysis failed:', error);
    }

    return {
      relevanceScore: 0,
      relevanceReason: 'AI 分析失敗',
      contentAngle: '',
      suggestedHooks: [],
    };
  }

  /**
   * 取得 Threads 發文績效數據
   */
  async getThreadsPerformanceData(): Promise<PerformanceData> {
    const pool = getPool();

    // 取得表現最好的貼文
    const [topPosts] = await pool.execute<RowDataPacket[]>(`
      SELECT
        pr.content,
        pi.views,
        pi.likes,
        pi.replies,
        pi.engagement_rate
      FROM post_insights pi
      JOIN posts p ON pi.post_id = p.id
      JOIN post_revisions pr ON pr.post_id = p.id
      WHERE p.status = 'POSTED'
        AND pi.views > 100
      ORDER BY pi.engagement_rate DESC
      LIMIT 10
    `);

    // 計算平均互動率
    const [avgRows] = await pool.execute<RowDataPacket[]>(`
      SELECT AVG(engagement_rate) as avg_rate
      FROM post_insights pi
      JOIN posts p ON pi.post_id = p.id
      WHERE p.status = 'POSTED' AND pi.views > 50
    `);

    // 分析最佳發文時段
    const [hourRows] = await pool.execute<RowDataPacket[]>(`
      SELECT
        HOUR(p.posted_at) as hour,
        AVG(pi.engagement_rate) as avg_rate
      FROM post_insights pi
      JOIN posts p ON pi.post_id = p.id
      WHERE p.status = 'POSTED' AND p.posted_at IS NOT NULL
      GROUP BY HOUR(p.posted_at)
      ORDER BY avg_rate DESC
      LIMIT 5
    `);

    return {
      topPosts: topPosts.map(p => ({
        content: p.content?.substring(0, 200) || '',
        views: p.views || 0,
        likes: p.likes || 0,
        replies: p.replies || 0,
        engagement_rate: p.engagement_rate || 0,
      })),
      avgEngagement: avgRows[0]?.avg_rate || 0,
      bestHours: hourRows.map(h => h.hour),
    };
  }

  /**
   * 生成內容建議
   */
  async generateContentSuggestion(
    topic: { title: string; angle: string; hooks: string[] },
    profile: BrandProfile,
    performanceData: PerformanceData
  ): Promise<{
    examplePost: string;
    predictedEngagement: number;
  }> {
    const topPostExamples = performanceData.topPosts
      .slice(0, 3)
      .map(p => p.content)
      .filter(c => c)
      .join('\n- ');

    const prompt = `【任務】根據熱門話題，創作一則 Threads 貼文

【話題】${topic.title}
【切入角度】${topic.angle}
【建議開頭】${topic.hooks.join(' / ')}

【參考成功貼文風格】
- ${topPostExamples || '無參考資料'}

【產品可自然帶入】
${profile.products.slice(0, 3).join('、')}

【輸出要求】
1. 50-100字
2. 每句獨立成行
3. 禁用逗號、頓號
4. 最多 2 個 emoji
5. 結尾可留反問或留白引發討論
6. 不要直接推銷產品，要從需求/痛點切入

請直接輸出貼文內容：`;

    const result = await aiService.generateContent({
      engine: EngineType.GPT4O,
      systemPrompt: `你是 ${profile.name} 的社群內容策略師。專門為 ${profile.industry} 創作 Threads 貼文。

風格要求：${profile.tone_style || '直白坦率但不低俗'}
禁區：${profile.content_taboos.join('、') || '無'}
目標：創造高互動、引發討論的短貼文`,
      stylePreset: prompt,
      maxTokens: 500,
    });

    return {
      examplePost: result.text.trim(),
      predictedEngagement: performanceData.avgEngagement * 1.2,
    };
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
   * 發送每日推薦摘要到 LINE
   */
  async sendDailySummaryToLine(suggestions: Array<{
    title: string;
    relevanceScore: number;
    angle: string;
    examplePost: string;
  }>): Promise<void> {
    const lineUserId = await this.getLineUserId();
    if (!lineUserId || suggestions.length === 0) return;

    let message = `📝 今日內容靈感推薦\n\n`;

    suggestions.slice(0, 3).forEach((s, i) => {
      message += `🔥 熱門話題 #${i + 1}：${s.title}\n`;
      message += `相關性：${s.relevanceScore.toFixed(1)} | 切角：${s.angle.substring(0, 20)}\n\n`;
      message += `💡 建議貼文：\n`;
      message += `「${s.examplePost.substring(0, 100)}${s.examplePost.length > 100 ? '...' : ''}」\n\n`;
      message += `---\n`;
    });

    await lineService.sendNotification(lineUserId, message);
    logger.info('[ContentRecommendation] Sent daily summary to LINE');
  }

  /**
   * 執行完整的內容推薦流程（排程入口）
   */
  async runContentRecommendation(): Promise<{
    topics: number;
    suggestions: number;
  }> {
    logger.info('[ContentRecommendation] Starting content recommendation...');

    const pool = getPool();

    // 1. 取得品牌 Profile
    const profile = await this.getBrandProfile();
    if (!profile) {
      logger.warn('[ContentRecommendation] No active brand profile found');
      return { topics: 0, suggestions: 0 };
    }

    // 2. 提取熱門話題
    const clusters = await this.extractTopicClusters(7, 2);
    logger.info(`[ContentRecommendation] Found ${clusters.length} topic clusters`);

    if (clusters.length === 0) {
      logger.info('[ContentRecommendation] No topics found, skipping');
      return { topics: 0, suggestions: 0 };
    }

    // 3. 取得 Threads 績效數據
    const performanceData = await this.getThreadsPerformanceData();

    // 4. 分析每個話題並生成建議
    const generatedSuggestions: Array<{
      title: string;
      relevanceScore: number;
      angle: string;
      examplePost: string;
    }> = [];

    for (const cluster of clusters.slice(0, 5)) {
      try {
        // 分析相關性
        const analysis = await this.analyzeTopicRelevance(cluster, profile);

        if (analysis.relevanceScore < 0.5) {
          logger.debug(`[ContentRecommendation] Skipping low relevance topic: ${cluster.keywords[0]}`);
          continue;
        }

        // 儲存話題
        const topicId = generateUUID();
        const topicTitle = cluster.keywords.slice(0, 3).join(' + ');

        await pool.execute(`
          INSERT INTO content_topics
            (id, topic_title, topic_summary, source_mentions, mention_count,
             relevance_score, relevance_reason, content_angle, suggested_hooks,
             avg_engagement, analyzed_at, expires_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), DATE_ADD(NOW(), INTERVAL 7 DAY))
        `, [
          topicId,
          topicTitle,
          analysis.relevanceReason,
          JSON.stringify(cluster.mentions.map(m => m.id)),
          cluster.mentions.length,
          analysis.relevanceScore,
          analysis.relevanceReason,
          analysis.contentAngle,
          JSON.stringify(analysis.suggestedHooks),
          cluster.totalEngagement / cluster.mentions.length,
        ]);

        // 生成內容建議
        const suggestion = await this.generateContentSuggestion(
          {
            title: topicTitle,
            angle: analysis.contentAngle,
            hooks: analysis.suggestedHooks,
          },
          profile,
          performanceData
        );

        // 儲存建議
        const suggestionId = generateUUID();
        await pool.execute(`
          INSERT INTO content_suggestions
            (id, topic_id, suggestion_type, title, description,
             suggested_hooks, suggested_angles, example_post,
             predicted_engagement, confidence_score, expires_at)
          VALUES (?, ?, 'topic_based', ?, ?, ?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 7 DAY))
        `, [
          suggestionId,
          topicId,
          topicTitle,
          analysis.contentAngle,
          JSON.stringify(analysis.suggestedHooks),
          JSON.stringify([analysis.contentAngle]),
          suggestion.examplePost,
          suggestion.predictedEngagement,
          analysis.relevanceScore,
        ]);

        generatedSuggestions.push({
          title: topicTitle,
          relevanceScore: analysis.relevanceScore,
          angle: analysis.contentAngle,
          examplePost: suggestion.examplePost,
        });

        logger.info(`[ContentRecommendation] Created suggestion for topic: ${topicTitle}`);
      } catch (error) {
        logger.error(`[ContentRecommendation] Error processing cluster:`, error);
      }
    }

    // 5. 發送 LINE 通知
    if (generatedSuggestions.length > 0) {
      await this.sendDailySummaryToLine(generatedSuggestions);
    }

    logger.info(`[ContentRecommendation] Content recommendation completed. Topics: ${clusters.length}, Suggestions: ${generatedSuggestions.length}`);

    return {
      topics: clusters.length,
      suggestions: generatedSuggestions.length,
    };
  }

  /**
   * 取得熱門話題列表
   */
  async getTopics(options: {
    status?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<{
    topics: any[];
    total: number;
  }> {
    const pool = getPool();
    const { status, limit = 20, offset = 0 } = options;

    let whereClause = 'WHERE expires_at > NOW()';
    const params: any[] = [];

    if (status) {
      whereClause += ' AND status = ?';
      params.push(status);
    }

    const [countRows] = await pool.execute<RowDataPacket[]>(
      `SELECT COUNT(*) as total FROM content_topics ${whereClause}`,
      params
    );

    const [topics] = await pool.execute<RowDataPacket[]>(
      `SELECT * FROM content_topics ${whereClause}
       ORDER BY relevance_score DESC, discovered_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    return {
      topics,
      total: countRows[0]?.total || 0,
    };
  }

  /**
   * 取得內容建議列表
   */
  async getSuggestions(options: {
    status?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<{
    suggestions: any[];
    total: number;
  }> {
    const pool = getPool();
    const { status, limit = 20, offset = 0 } = options;

    let whereClause = 'WHERE cs.expires_at > NOW()';
    const params: any[] = [];

    if (status) {
      whereClause += ' AND cs.status = ?';
      params.push(status);
    }

    const [countRows] = await pool.execute<RowDataPacket[]>(
      `SELECT COUNT(*) as total FROM content_suggestions cs ${whereClause}`,
      params
    );

    const [suggestions] = await pool.execute<RowDataPacket[]>(
      `SELECT cs.*, ct.topic_title, ct.relevance_score
       FROM content_suggestions cs
       LEFT JOIN content_topics ct ON cs.topic_id = ct.id
       ${whereClause}
       ORDER BY cs.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    return {
      suggestions,
      total: countRows[0]?.total || 0,
    };
  }

  /**
   * 採用建議
   */
  async adoptSuggestion(suggestionId: string, postId?: string): Promise<void> {
    const pool = getPool();

    await pool.execute(`
      UPDATE content_suggestions
      SET status = 'adopted', adopted_post_id = ?
      WHERE id = ?
    `, [postId || null, suggestionId]);

    // 同時更新對應話題
    await pool.execute(`
      UPDATE content_topics ct
      SET status = 'used', used_post_id = ?
      WHERE id = (SELECT topic_id FROM content_suggestions WHERE id = ?)
    `, [postId || null, suggestionId]);

    logger.info(`[ContentRecommendation] Adopted suggestion ${suggestionId}`);
  }

  /**
   * 拒絕建議
   */
  async rejectSuggestion(suggestionId: string): Promise<void> {
    const pool = getPool();

    await pool.execute(`
      UPDATE content_suggestions SET status = 'rejected' WHERE id = ?
    `, [suggestionId]);

    logger.info(`[ContentRecommendation] Rejected suggestion ${suggestionId}`);
  }

  /**
   * 取得今日最佳話題（用於注入 Prompt Builder）
   * 返回相關性最高且尚未使用的話題
   */
  async getTodayTopTopic(): Promise<{
    topicTitle: string;
    contentAngle: string;
    suggestedHooks: string[];
    relevanceScore: number;
    topicId: string;
  } | null> {
    const pool = getPool();

    try {
      // 取得今天生成的、相關性高於 0.6、尚未使用的話題
      const [topics] = await pool.execute<RowDataPacket[]>(`
        SELECT id, topic_title, content_angle, suggested_hooks, relevance_score
        FROM content_topics
        WHERE status = 'new'
          AND relevance_score >= 0.6
          AND expires_at > NOW()
          AND DATE(discovered_at) >= DATE_SUB(CURDATE(), INTERVAL 3 DAY)
        ORDER BY relevance_score DESC, avg_engagement DESC
        LIMIT 1
      `);

      if (topics.length === 0) {
        logger.debug('[ContentRecommendation] No suitable topic found for today');
        return null;
      }

      const topic = topics[0];
      return {
        topicId: topic.id,
        topicTitle: topic.topic_title,
        contentAngle: topic.content_angle || '',
        suggestedHooks: this.parseJSON<string[]>(topic.suggested_hooks, []),
        relevanceScore: parseFloat(topic.relevance_score) || 0,
      };
    } catch (error) {
      logger.error('[ContentRecommendation] Failed to get today top topic:', error);
      return null;
    }
  }

  /**
   * 標記話題為已使用
   */
  async markTopicAsUsed(topicId: string, postId?: string): Promise<void> {
    const pool = getPool();

    await pool.execute(`
      UPDATE content_topics
      SET status = 'used', used_post_id = ?
      WHERE id = ?
    `, [postId || null, topicId]);

    logger.info(`[ContentRecommendation] Marked topic ${topicId} as used`);
  }
}

export default new ContentRecommendationService();
