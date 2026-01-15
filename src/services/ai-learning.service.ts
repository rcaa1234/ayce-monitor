/**
 * AI 學習服務
 * 分析過去 AI 生成文章的表現，選擇最佳主題/風格
 * 並提供成功範例給 AI 參考
 */

import { getPool } from '../database/connection';
import { RowDataPacket } from 'mysql2';
import logger from '../utils/logger';

// 主題類別及其權重
export interface TopicCategory {
    id: string;
    name: string;
    description: string;
    keywords: string[];
    weight: number;
    trial_count: number;
    success_count: number;
    avg_engagement: number;
}

// 文章表現數據
export interface PostPerformance {
    post_id: string;
    content: string;
    topic_category: string;
    views: number;
    likes: number;
    replies: number;
    reposts: number;
    quotes: number;
    engagement_score: number;
    posted_at: Date;
}

// 成功範例
export interface SuccessExample {
    content: string;
    topic: string;
    engagement_score: number;
}

class AILearningService {
    /**
     * 取得過去 AI 生成文章的表現數據
     * @param limit 要取得的文章數量
     */
    async getAIPostsPerformance(limit: number = 50): Promise<PostPerformance[]> {
        const pool = getPool();

        try {
            const [rows] = await pool.execute<RowDataPacket[]>(
                `SELECT 
          p.id as post_id,
          pr.content,
          p.topic_category,
          COALESCE(pi.views, 0) as views,
          COALESCE(pi.likes, 0) as likes,
          COALESCE(pi.replies, 0) as replies,
          COALESCE(pi.reposts, 0) as reposts,
          COALESCE(pi.quotes, 0) as quotes,
          COALESCE(
            (pi.likes * 3 + pi.replies * 5 + pi.reposts * 4 + pi.quotes * 4) / 
            GREATEST(pi.views, 1) * 100, 0
          ) as engagement_score,
          p.posted_at
        FROM posts p
        INNER JOIN post_revisions pr ON p.id = pr.post_id AND pr.revision_no = (
          SELECT MAX(pr2.revision_no) FROM post_revisions pr2 WHERE pr2.post_id = p.id
        )
        LEFT JOIN post_insights pi ON p.id = pi.post_id
        WHERE p.is_ai_generated = true 
          AND p.status = 'POSTED'
          AND p.posted_at IS NOT NULL
        ORDER BY p.posted_at DESC
        LIMIT ?`,
                [limit]
            );

            return rows as PostPerformance[];
        } catch (error) {
            logger.error('Failed to get AI posts performance:', error);
            return [];
        }
    }

    /**
     * 取得最成功的 AI 文章作為範例
     * @param topN 要取得的範例數量
     */
    async getTopPerformingPosts(topN: number = 5): Promise<SuccessExample[]> {
        const pool = getPool();

        try {
            const [rows] = await pool.execute<RowDataPacket[]>(
                `SELECT 
          pr.content,
          COALESCE(p.topic_category, 'general') as topic,
          (COALESCE(pi.likes, 0) * 3 + COALESCE(pi.replies, 0) * 5 + 
           COALESCE(pi.reposts, 0) * 4 + COALESCE(pi.quotes, 0) * 4) as engagement_score
        FROM posts p
        INNER JOIN post_revisions pr ON p.id = pr.post_id AND pr.revision_no = (
          SELECT MAX(pr2.revision_no) FROM post_revisions pr2 WHERE pr2.post_id = p.id
        )
        LEFT JOIN post_insights pi ON p.id = pi.post_id
        WHERE p.is_ai_generated = true 
          AND p.status = 'POSTED'
          AND p.posted_at IS NOT NULL
          AND p.posted_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
        ORDER BY engagement_score DESC
        LIMIT ?`,
                [topN]
            );

            return rows as SuccessExample[];
        } catch (error) {
            logger.error('Failed to get top performing posts:', error);
            return [];
        }
    }

    /**
     * 分析主題表現並計算權重
     */
    async analyzeTopicPerformance(): Promise<Map<string, { count: number; avgEngagement: number; weight: number }>> {
        const posts = await this.getAIPostsPerformance(100);

        const topicStats = new Map<string, { count: number; totalEngagement: number }>();

        for (const post of posts) {
            const topic = post.topic_category || 'general';
            const current = topicStats.get(topic) || { count: 0, totalEngagement: 0 };
            current.count++;
            current.totalEngagement += post.engagement_score;
            topicStats.set(topic, current);
        }

        // 計算權重 (使用 UCB-like 公式)
        const totalTrials = posts.length || 1;
        const result = new Map<string, { count: number; avgEngagement: number; weight: number }>();

        for (const [topic, stats] of topicStats) {
            const avgEngagement = stats.totalEngagement / stats.count;
            // UCB formula: avg + sqrt(2 * ln(total) / trials)
            const explorationBonus = Math.sqrt(2 * Math.log(totalTrials) / stats.count);
            const weight = avgEngagement + explorationBonus * 10; // Scale bonus

            result.set(topic, {
                count: stats.count,
                avgEngagement,
                weight,
            });
        }

        return result;
    }

    /**
     * 根據過去表現選擇最佳主題
     */
    async selectBestTopic(): Promise<string | null> {
        const topicWeights = await this.analyzeTopicPerformance();

        if (topicWeights.size === 0) {
            return null;
        }

        // 使用加權隨機選擇
        let totalWeight = 0;
        for (const [, stats] of topicWeights) {
            totalWeight += stats.weight;
        }

        const random = Math.random() * totalWeight;
        let cumulative = 0;

        for (const [topic, stats] of topicWeights) {
            cumulative += stats.weight;
            if (random <= cumulative) {
                return topic;
            }
        }

        return 'general';
    }

    /**
     * 為 AI 生成建構包含歷史參考的提示詞
     * @param basePrompt 原始提示詞
     * @param includeExamples 是否包含成功範例
     */
    async buildEnhancedPrompt(basePrompt: string, includeExamples: boolean = true): Promise<string> {
        let enhancedPrompt = basePrompt;

        if (includeExamples) {
            const examples = await this.getTopPerformingPosts(3);

            if (examples.length > 0) {
                enhancedPrompt += '\n\n---\n以下是過去表現優秀的貼文範例，請參考其風格和結構（但不要直接複製）：\n';

                examples.forEach((ex, idx) => {
                    enhancedPrompt += `\n【範例 ${idx + 1}】(互動分數: ${ex.engagement_score.toFixed(0)})\n`;
                    enhancedPrompt += ex.content.substring(0, 300);
                    if (ex.content.length > 300) enhancedPrompt += '...';
                    enhancedPrompt += '\n';
                });

                enhancedPrompt += '\n---\n請創作一篇新的貼文，參考以上範例的成功要素，但要有原創性：';
            }
        }

        // 加入表現分析提示
        const topicAnalysis = await this.analyzeTopicPerformance();
        if (topicAnalysis.size > 0) {
            const sortedTopics = Array.from(topicAnalysis.entries())
                .sort((a, b) => b[1].avgEngagement - a[1].avgEngagement)
                .slice(0, 3);

            if (sortedTopics.length > 0) {
                enhancedPrompt += '\n\n📊 近期表現最佳的主題風格：';
                sortedTopics.forEach(([topic, stats]) => {
                    enhancedPrompt += `\n- ${topic}: 平均互動 ${stats.avgEngagement.toFixed(1)}`;
                });
            }
        }

        return enhancedPrompt;
    }

    /**
     * 取得 AI 生成統計數據
     */
    async getAIGenerationStats(): Promise<{
        totalAIPosts: number;
        last30DaysPosts: number;
        avgEngagement: number;
        topTopics: Array<{ topic: string; count: number; avgEngagement: number }>;
    }> {
        const pool = getPool();

        try {
            // 總 AI 貼文數
            const [totalRows] = await pool.execute<RowDataPacket[]>(
                `SELECT COUNT(*) as count FROM posts WHERE is_ai_generated = true AND status = 'POSTED'`
            );
            const totalAIPosts = totalRows[0]?.count || 0;

            // 近 30 天 AI 貼文數
            const [recentRows] = await pool.execute<RowDataPacket[]>(
                `SELECT COUNT(*) as count FROM posts 
         WHERE is_ai_generated = true AND status = 'POSTED' 
         AND posted_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)`
            );
            const last30DaysPosts = recentRows[0]?.count || 0;

            // 平均互動率
            const [engagementRows] = await pool.execute<RowDataPacket[]>(
                `SELECT AVG(
          (COALESCE(pi.likes, 0) * 3 + COALESCE(pi.replies, 0) * 5 + 
           COALESCE(pi.reposts, 0) * 4 + COALESCE(pi.quotes, 0) * 4)
         ) as avg_eng
         FROM posts p
         LEFT JOIN post_insights pi ON p.id = pi.post_id
         WHERE p.is_ai_generated = true AND p.status = 'POSTED'
         AND p.posted_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)`
            );
            const avgEngagement = engagementRows[0]?.avg_eng || 0;

            // 主題分析
            const topicAnalysis = await this.analyzeTopicPerformance();
            const topTopics = Array.from(topicAnalysis.entries())
                .map(([topic, stats]) => ({
                    topic,
                    count: stats.count,
                    avgEngagement: stats.avgEngagement,
                }))
                .sort((a, b) => b.avgEngagement - a.avgEngagement)
                .slice(0, 5);

            return {
                totalAIPosts,
                last30DaysPosts,
                avgEngagement,
                topTopics,
            };
        } catch (error) {
            logger.error('Failed to get AI generation stats:', error);
            return {
                totalAIPosts: 0,
                last30DaysPosts: 0,
                avgEngagement: 0,
                topTopics: [],
            };
        }
    }

    /**
     * 自動分類文章主題（基於內容關鍵字）
     */
    classifyContent(content: string): string {
        const topicKeywords: Record<string, string[]> = {
            'emotional': ['感情', '愛情', '心情', '感受', '難過', '開心', '幸福', '心痛', '想念', '暖心'],
            'humor': ['笑死', '好笑', '幽默', '搞笑', '哈哈', 'XD', '太扯', '離譜', '神奇'],
            'life': ['生活', '日常', '工作', '職場', '同事', '老闆', '週末', '休假'],
            'motivation': ['加油', '努力', '堅持', '夢想', '目標', '成長', '進步', '突破'],
            'relationship': ['朋友', '閨蜜', '社交', '人際', '相處', '聚會'],
            'food': ['美食', '吃', '餐廳', '料理', '甜點', '咖啡', '好吃'],
            'sexy': ['性感', '慾望', '誘惑', '魅力', '迷人', '性', '身體'],
        };

        const contentLower = content.toLowerCase();
        const scores: Record<string, number> = {};

        for (const [topic, keywords] of Object.entries(topicKeywords)) {
            scores[topic] = keywords.filter(kw => contentLower.includes(kw)).length;
        }

        const maxScore = Math.max(...Object.values(scores));
        if (maxScore === 0) {
            return 'general';
        }

        return Object.entries(scores).find(([, score]) => score === maxScore)?.[0] || 'general';
    }
}

export default new AILearningService();
