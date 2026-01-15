/**
 * Generation Planner Service
 * 生成前決策層 - 完全不叫 LLM，純邏輯
 * 
 * 功能：
 * 1. 讀取最近 30 天貼文的統計
 * 2. 根據權重和相容性決定 generation_plan
 * 3. 套用相容矩陣與黑名單規則
 */

import { getPool } from '../database/connection';
import { RowDataPacket } from 'mysql2';
import logger from '../utils/logger';

// Generation Plan 結構
export interface GenerationPlan {
    module: string;
    moduleName: string;
    angle: string;
    angleName: string;
    outlet: string;
    outletName: string;
    toneBias: string;
    toneBiasName: string;
    endingStyle: string;
    endingStyleName: string;
    lengthTarget: string;
    lengthTargetName: string;
    generatedAt: string;
}

// 維度選項
interface DimensionOption {
    code: string;
    name: string;
    description: string;
    weight: number;
    compatibleModules?: string[];
    incompatibleWith?: string[];
}

class PlannerService {
    /**
     * 取得某維度的所有啟用選項
     */
    async getDimensionOptions(dimensionType: string): Promise<DimensionOption[]> {
        const pool = getPool();

        try {
            const [rows] = await pool.execute<RowDataPacket[]>(
                `SELECT code, name, description, weight, compatible_modules, incompatible_with
         FROM generation_dimensions 
         WHERE dimension_type = ? AND is_active = true
         ORDER BY display_order`,
                [dimensionType]
            );

            return rows.map(row => ({
                code: row.code,
                name: row.name,
                description: row.description,
                weight: parseFloat(row.weight),
                compatibleModules: row.compatible_modules ? JSON.parse(row.compatible_modules) : null,
                incompatibleWith: row.incompatible_with ? JSON.parse(row.incompatible_with) : null,
            }));
        } catch (error) {
            logger.error(`Failed to get dimension options for ${dimensionType}:`, error);
            return [];
        }
    }

    /**
     * 取得最近 30 天的維度使用統計
     */
    async getRecentDimensionStats(): Promise<Map<string, Map<string, number>>> {
        const pool = getPool();
        const stats = new Map<string, Map<string, number>>();

        try {
            const [rows] = await pool.execute<RowDataPacket[]>(
                `SELECT topic_category, angle, outlet, tone_bias, ending_style, length_target
         FROM posts 
         WHERE is_ai_generated = true 
           AND status = 'POSTED'
           AND posted_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)`
            );

            // 初始化統計
            const dimensions = ['module', 'angle', 'outlet', 'tone_bias', 'ending_style', 'length_target'];
            for (const dim of dimensions) {
                stats.set(dim, new Map());
            }

            for (const row of rows) {
                // Module (stored as topic_category)
                if (row.topic_category) {
                    const moduleStats = stats.get('module')!;
                    moduleStats.set(row.topic_category, (moduleStats.get(row.topic_category) || 0) + 1);
                }

                // 其他維度
                for (const dim of ['angle', 'outlet', 'tone_bias', 'ending_style', 'length_target']) {
                    if (row[dim]) {
                        const dimStats = stats.get(dim)!;
                        dimStats.set(row[dim], (dimStats.get(row[dim]) || 0) + 1);
                    }
                }
            }

            return stats;
        } catch (error) {
            logger.error('Failed to get recent dimension stats:', error);
            return stats;
        }
    }

    /**
     * 根據權重和使用統計選擇一個選項
     * 使用 UCB-like 公式：weight + exploration_bonus - usage_penalty
     */
    selectByWeightedRandom(
        options: DimensionOption[],
        usageStats: Map<string, number>,
        totalPosts: number,
        selectedModule?: string
    ): DimensionOption | null {
        if (options.length === 0) return null;

        // 過濾相容性
        let filteredOptions = options;
        if (selectedModule) {
            filteredOptions = options.filter(opt => {
                if (!opt.compatibleModules) return true;
                return opt.compatibleModules.includes(selectedModule);
            });

            if (filteredOptions.length === 0) {
                filteredOptions = options; // 沒有相容的就用全部
            }
        }

        // 計算各選項的加權分數
        const scores: { option: DimensionOption; score: number }[] = [];

        for (const opt of filteredOptions) {
            const usageCount = usageStats.get(opt.code) || 0;
            const usageRatio = totalPosts > 0 ? usageCount / totalPosts : 0;

            // 基礎分數 = 權重
            let score = opt.weight;

            // 如果使用次數低於預期，增加探索獎勵
            const expectedRatio = opt.weight;
            if (usageRatio < expectedRatio * 0.8) {
                score += 0.1; // 探索獎勵
            }

            // 如果使用次數高於預期，減少分數避免過度使用
            if (usageRatio > expectedRatio * 1.2) {
                score -= 0.05;
            }

            scores.push({ option: opt, score: Math.max(0.01, score) });
        }

        // 加權隨機選擇
        const totalScore = scores.reduce((sum, s) => sum + s.score, 0);
        const random = Math.random() * totalScore;
        let cumulative = 0;

        for (const { option, score } of scores) {
            cumulative += score;
            if (random <= cumulative) {
                return option;
            }
        }

        return scores[0]?.option || null;
    }

    /**
     * 生成完整的 Generation Plan
     */
    async generatePlan(): Promise<GenerationPlan> {
        logger.info('[Planner] Generating new plan...');

        // 取得所有維度選項
        const [modules, angles, outlets, toneBiases, endingStyles, lengthTargets] = await Promise.all([
            this.getDimensionOptions('module'),
            this.getDimensionOptions('angle'),
            this.getDimensionOptions('outlet'),
            this.getDimensionOptions('tone_bias'),
            this.getDimensionOptions('ending_style'),
            this.getDimensionOptions('length_target'),
        ]);

        // 取得使用統計
        const recentStats = await this.getRecentDimensionStats();
        const totalPosts = Array.from(recentStats.get('module')?.values() || []).reduce((a, b) => a + b, 0);

        // 1. 選擇 MODULE
        const selectedModule = this.selectByWeightedRandom(
            modules,
            recentStats.get('module') || new Map(),
            totalPosts
        );

        // 2. 選擇 ANGLE（可選，30篇中最多10篇用場景）
        let selectedAngle: DimensionOption | null = null;
        const angleStats = recentStats.get('angle') || new Map();
        const angleUsageCount = Array.from(angleStats.values()).reduce((a, b) => a + b, 0);

        // 如果最近場景使用不到 1/3，就有機會選場景
        if (Math.random() < 0.33 || angleUsageCount < totalPosts / 3) {
            selectedAngle = this.selectByWeightedRandom(
                angles,
                angleStats,
                totalPosts
            );
        }

        // 3. 選擇 OUTLET（根據 MODULE 相容性）
        const selectedOutlet = this.selectByWeightedRandom(
            outlets,
            recentStats.get('outlet') || new Map(),
            totalPosts,
            selectedModule?.code
        );

        // 4. 選擇 TONE_BIAS
        const selectedTone = this.selectByWeightedRandom(
            toneBiases,
            recentStats.get('tone_bias') || new Map(),
            totalPosts
        );

        // 5. 選擇 ENDING_STYLE
        const selectedEnding = this.selectByWeightedRandom(
            endingStyles,
            recentStats.get('ending_style') || new Map(),
            totalPosts
        );

        // 6. 選擇 LENGTH_TARGET
        const selectedLength = this.selectByWeightedRandom(
            lengthTargets,
            recentStats.get('length_target') || new Map(),
            totalPosts
        );

        const plan: GenerationPlan = {
            module: selectedModule?.code || 'pleasure_relief',
            moduleName: selectedModule?.name || '爽與解壓',
            angle: selectedAngle?.code || '',
            angleName: selectedAngle?.name || '',
            outlet: selectedOutlet?.code || 'solo_quick',
            outletName: selectedOutlet?.name || '自慰-快戰速決',
            toneBias: selectedTone?.code || 'blunt_raw',
            toneBiasName: selectedTone?.name || '直白粗暴',
            endingStyle: selectedEnding?.code || 'done_sleep',
            endingStyleName: selectedEnding?.name || '收工型',
            lengthTarget: selectedLength?.code || '70-95',
            lengthTargetName: selectedLength?.name || '中等',
            generatedAt: new Date().toISOString(),
        };

        logger.info(`[Planner] Generated plan: MODULE=${plan.moduleName}, ANGLE=${plan.angleName || '無'}, OUTLET=${plan.outletName}, TONE=${plan.toneBiasName}, ENDING=${plan.endingStyleName}, LENGTH=${plan.lengthTarget}`);

        return plan;
    }

    /**
     * 取得最近 N 篇貼文的摘要（用於 Avoid Block）
     */
    async getRecentPostsSummary(limit: number = 15): Promise<string[]> {
        const pool = getPool();

        try {
            const [rows] = await pool.execute<RowDataPacket[]>(
                `SELECT pr.content
         FROM posts p
         INNER JOIN post_revisions pr ON p.id = pr.post_id AND pr.revision_no = (
           SELECT MAX(pr2.revision_no) FROM post_revisions pr2 WHERE pr2.post_id = p.id
         )
         WHERE p.is_ai_generated = true AND p.status = 'POSTED'
         ORDER BY p.posted_at DESC
         LIMIT ?`,
                [limit]
            );

            // 取每篇的前 50 字作為摘要
            return rows.map(row => row.content.substring(0, 50));
        } catch (error) {
            logger.error('Failed to get recent posts summary:', error);
            return [];
        }
    }
}

export default new PlannerService();
