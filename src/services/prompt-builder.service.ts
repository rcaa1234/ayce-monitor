/**
 * Prompt Builder Service
 * 提示詞組裝層
 * 
 * 組裝：Master Prompt + Plan Block + Avoid Block + Output Contract
 */

import { GenerationPlan } from './planner.service';
import plannerService from './planner.service';
import aiLearningService from './ai-learning.service';
import logger from '../utils/logger';

// 禁用詞/句型清單
const BANNED_PHRASES = [
    '浪漫退位',
    '放過性慾',
    '顧節奏',
    '不想顧任何節奏',
    '身體有點撐',
    '身體在撐',
    '性慾很直接',
    '對性的反應',
    '慾望的流動',
    '狀態退回',
    '本來就',
    '也是一種選擇',
    '被接住',
    '值得',
    '不委屈',
    '把高潮解掉',
    '身體會告訴你',
    '今天先這樣',
    '就這樣',
    '故意不爽',
    '爽完更煩',
    '根本不是性',
];

// 禁用開頭詞
const BANNED_STARTS = [
    '有些時候',
    '有些人',
    '我',
    '我的',
    '今天',
    '剛剛',
    '現在',
    '自己覺得',
    '個人感受',
    '這陣子我',
];

class PromptBuilderService {
    /**
     * 組裝完整提示詞
     */
    async buildFullPrompt(masterPrompt: string, plan: GenerationPlan): Promise<string> {
        let fullPrompt = '';

        // 1. Master Prompt（用戶維護的主提示詞）
        fullPrompt += masterPrompt;

        // 2. Plan Block（今日生成計劃）
        fullPrompt += '\n\n' + this.buildPlanBlock(plan);

        // 3. Avoid Block（避免重複）
        const avoidBlock = await this.buildAvoidBlock();
        if (avoidBlock) {
            fullPrompt += '\n\n' + avoidBlock;
        }

        // 4. Examples Block（成功範例）
        const examplesBlock = await this.buildExamplesBlock();
        if (examplesBlock) {
            fullPrompt += '\n\n' + examplesBlock;
        }

        // 5. Output Contract（輸出格式要求）
        fullPrompt += '\n\n' + this.buildOutputContract(plan);

        // 處理佔位符
        fullPrompt = this.replacePlaceholders(fullPrompt, plan);

        logger.info(`[PromptBuilder] Built prompt with ${fullPrompt.length} characters`);

        return fullPrompt;
    }

    /**
     * 構建 Plan Block
     */
    buildPlanBlock(plan: GenerationPlan): string {
        let block = '═══════════════════════════════════════\n';
        block += '📋 【本次生成計劃】\n';
        block += '═══════════════════════════════════════\n\n';

        block += `🎯 內容模組：【${plan.moduleName}】\n`;
        block += `   → ${this.getModuleDescription(plan.module)}\n\n`;

        if (plan.angleName) {
            block += `🎬 情境切角：【${plan.angleName}】\n`;
            block += `   → 可以從這個場景切入，但不是必須\n\n`;
        }

        block += `💡 處理出口：【${plan.outletName}】\n`;
        block += `   → 這篇文章要引導到這個方向\n\n`;

        block += `🗣️ 語氣偏壓：【${plan.toneBiasName}】\n`;
        block += `   → 整體語感要偏向這個調性\n\n`;

        block += `🔚 收尾意圖：【${plan.endingStyleName}】\n`;
        block += `   → 結尾要達成這個效果\n\n`;

        block += `📏 字數目標：【${plan.lengthTarget}字】\n`;
        block += `   → 嚴格控制在這個範圍\n`;

        return block;
    }

    /**
     * 構建 Avoid Block（避免重複）
     */
    async buildAvoidBlock(): Promise<string> {
        const recentSummaries = await plannerService.getRecentPostsSummary(10);

        if (recentSummaries.length === 0) {
            return '';
        }

        let block = '═══════════════════════════════════════\n';
        block += '⚠️ 【避免重複】\n';
        block += '═══════════════════════════════════════\n\n';

        block += '以下是最近發過的貼文開頭，請避免相似的：\n';
        recentSummaries.forEach((summary, idx) => {
            block += `${idx + 1}. 「${summary}...」\n`;
        });

        block += '\n請確保新貼文的開頭和整體結構不要與以上相似。';

        return block;
    }

    /**
     * 構建 Examples Block（成功範例）
     */
    async buildExamplesBlock(): Promise<string> {
        const examples = await aiLearningService.getTopPerformingPosts(3);

        if (examples.length === 0) {
            return '';
        }

        let block = '═══════════════════════════════════════\n';
        block += '✨ 【參考成功範例】\n';
        block += '═══════════════════════════════════════\n\n';

        block += '以下是過去互動最好的貼文，參考其風格（但不要複製）：\n\n';

        examples.forEach((ex, idx) => {
            block += `【範例 ${idx + 1}】互動分數: ${ex.engagement_score.toFixed(0)}\n`;
            block += `${ex.content.substring(0, 200)}\n`;
            if (ex.content.length > 200) block += '...\n';
            block += '\n';
        });

        return block;
    }

    /**
     * 構建 Output Contract（輸出格式要求）
     */
    buildOutputContract(plan: GenerationPlan): string {
        const [minLength, maxLength] = plan.lengthTarget.split('-').map(Number);

        let block = '═══════════════════════════════════════\n';
        block += '📝 【輸出格式規範】（硬性規則）\n';
        block += '═══════════════════════════════════════\n\n';

        block += '1. 只輸出貼文正文，不加任何說明\n';
        block += '2. 不加標題、不加 hashtag\n';
        block += '3. 每一句必須獨立成行\n';
        block += '4. 禁止使用逗號「，」、頓號「、」、分號「；」\n';
        block += '5. 禁止將兩個意思寫在同一行\n';
        block += `6. 字數嚴格控制在 ${minLength}-${maxLength} 字\n`;
        block += '7. Emoji 最多 2 個\n';
        block += '8. 禁止第一人稱開頭（我、我的、今天我）\n\n';

        block += '❌ 禁用詞彙（出現則整篇作廢）：\n';
        block += BANNED_PHRASES.slice(0, 10).join('、') + '...\n\n';

        block += '現在請直接輸出貼文正文：';

        return block;
    }

    /**
     * 替換佔位符
     */
    replacePlaceholders(prompt: string, plan: GenerationPlan): string {
        let result = prompt;

        result = result.replace(/{MODULE}/g, plan.moduleName);
        result = result.replace(/{ANGLE}/g, plan.angleName || '（無特定場景）');
        result = result.replace(/{OUTLET}/g, plan.outletName);
        result = result.replace(/{TONE}/g, plan.toneBiasName);
        result = result.replace(/{ENDING}/g, plan.endingStyleName);
        result = result.replace(/{LENGTH}/g, plan.lengthTarget);

        // 移除未使用的 {PAST_EXAMPLES} 佔位符（已在 Examples Block 處理）
        result = result.replace(/{PAST_EXAMPLES}/g, '（已在上方提供）');

        return result;
    }

    /**
     * 取得模組說明
     */
    getModuleDescription(module: string): string {
        const descriptions: Record<string, string> = {
            'pleasure_relief': '高潮舒壓、快感釋放、慾火起來、讓人覺得「爽是合理的」',
            'practical': '不想等、不想配合、懶得前戲、想快一點、省事快戰速決',
            'uncomfortable_truth': '爽完不想理人、真人vs玩具殘酷對比、自私但不道歉',
            'controversial': '反問、拋殘酷事實、不給答案、引戰留言區爆',
        };
        return descriptions[module] || '';
    }

    /**
     * 取得禁用詞清單
     */
    getBannedPhrases(): string[] {
        return BANNED_PHRASES;
    }

    /**
     * 取得禁用開頭詞清單
     */
    getBannedStarts(): string[] {
        return BANNED_STARTS;
    }
}

export default new PromptBuilderService();
