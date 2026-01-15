/**
 * Post Check Service
 * 生成後檢測與重試層
 * 
 * 檢查：
 * - 字數是否符合範圍
 * - 格式是否正確（換行、禁標點）
 * - 是否像日記（命中禁詞/第一人稱）
 * - 是否邏輯衝突
 * - 是否與最近貼文重複
 */

import { GenerationPlan } from './planner.service';
import promptBuilderService from './prompt-builder.service';
import logger from '../utils/logger';

// 檢測結果
export interface PostCheckResult {
    passed: boolean;
    issues: string[];
    riskFlags: string[];
    metrics: {
        charCount: number;
        lineCount: number;
        hasComma: boolean;
        hasFirstPerson: boolean;
        hasBannedPhrase: boolean;
        emojiCount: number;
        similarityScore: number;
    };
    suggestions: string[];
}

class PostCheckService {
    /**
     * 檢測生成的內容
     */
    checkContent(content: string, plan: GenerationPlan, recentPosts: string[] = []): PostCheckResult {
        const issues: string[] = [];
        const riskFlags: string[] = [];
        const suggestions: string[] = [];

        // 1. 字數檢查
        const charCount = this.countChineseChars(content);
        const [minLength, maxLength] = plan.lengthTarget.split('-').map(Number);

        if (charCount < minLength) {
            issues.push(`字數不足：${charCount}字 < ${minLength}字`);
            riskFlags.push('TOO_SHORT');
            suggestions.push('請增加內容長度');
        }

        if (charCount > maxLength) {
            issues.push(`字數超過：${charCount}字 > ${maxLength}字`);
            riskFlags.push('TOO_LONG');
            suggestions.push('請精簡內容');
        }

        // 2. 格式檢查
        const hasComma = /[，、；]/.test(content);
        if (hasComma) {
            issues.push('包含禁用標點符號（逗號、頓號、分號）');
            riskFlags.push('HAS_COMMA');
            suggestions.push('將逗號/頓號改為換行');
        }

        const lines = content.split('\n').filter(l => l.trim());
        const lineCount = lines.length;

        if (lineCount < 2) {
            issues.push('沒有換行，整段式輸出');
            riskFlags.push('NO_LINE_BREAK');
            suggestions.push('每句話獨立成行');
        }

        // 檢查是否有太長的單行（超過 40 字）
        const longLines = lines.filter(l => this.countChineseChars(l) > 40);
        if (longLines.length > 0) {
            issues.push(`有 ${longLines.length} 行超過 40 字`);
            riskFlags.push('LONG_LINES');
            suggestions.push('將長句拆分成多行');
        }

        // 3. 第一人稱檢查
        const firstPersonPatterns = /^(我|我的|今天我|這陣子我|個人覺得|自己覺得)/;
        const hasFirstPerson = lines.some(l => firstPersonPatterns.test(l.trim()));

        if (hasFirstPerson) {
            issues.push('使用第一人稱開頭');
            riskFlags.push('FIRST_PERSON');
            suggestions.push('避免「我」開頭');
        }

        // 4. 禁用詞檢查
        const bannedPhrases = promptBuilderService.getBannedPhrases();
        const foundBanned: string[] = [];

        for (const phrase of bannedPhrases) {
            if (content.includes(phrase)) {
                foundBanned.push(phrase);
            }
        }

        const hasBannedPhrase = foundBanned.length > 0;
        if (hasBannedPhrase) {
            issues.push(`包含禁用詞：${foundBanned.join('、')}`);
            riskFlags.push('BANNED_PHRASE');
            suggestions.push('移除或替換禁用詞');
        }

        // 5. Emoji 數量檢查
        const emojiCount = this.countEmojis(content);
        if (emojiCount > 2) {
            issues.push(`Emoji 過多：${emojiCount} 個`);
            riskFlags.push('TOO_MANY_EMOJI');
            suggestions.push('Emoji 最多 2 個');
        }

        // 6. 相似度檢查（與最近貼文）
        let maxSimilarity = 0;
        if (recentPosts.length > 0) {
            for (const recent of recentPosts) {
                const similarity = this.calculateSimilarity(content, recent);
                if (similarity > maxSimilarity) {
                    maxSimilarity = similarity;
                }
            }

            if (maxSimilarity > 0.6) {
                issues.push(`與最近貼文相似度過高：${(maxSimilarity * 100).toFixed(0)}%`);
                riskFlags.push('TOO_SIMILAR');
                suggestions.push('換個角度或開頭');
            }
        }

        // 7. 性相關內容檢查（最低門檻）
        const sexKeywords = ['性', '慾', '快感', '高潮', '自慰', '玩具', '親密', '爽', '舒服', '敏感', '想要'];
        const hasSexContent = sexKeywords.some(kw => content.includes(kw));

        if (!hasSexContent) {
            issues.push('缺少性相關內容');
            riskFlags.push('NO_SEX_CONTENT');
            suggestions.push('必須包含至少一個性相關元素');
        }

        // 8. 結尾檢查（不能是安慰/總結/教訓）
        const lastLine = lines[lines.length - 1]?.trim() || '';
        const badEndings = ['加油', '值得', '被愛', '沒關係', '慢慢來', '會好的', '相信'];
        const hasBadEnding = badEndings.some(e => lastLine.includes(e));

        if (hasBadEnding) {
            issues.push('結尾像安慰或說教');
            riskFlags.push('BAD_ENDING');
            suggestions.push('結尾要直接、不上價值');
        }

        const passed = issues.length === 0;

        return {
            passed,
            issues,
            riskFlags,
            metrics: {
                charCount,
                lineCount,
                hasComma,
                hasFirstPerson,
                hasBannedPhrase,
                emojiCount,
                similarityScore: maxSimilarity,
            },
            suggestions,
        };
    }

    /**
     * 計算中文字數（不含空格和標點）
     */
    countChineseChars(text: string): number {
        // 移除空格、換行、標點、emoji
        const cleaned = text
            .replace(/[\s\n]/g, '')
            .replace(/[，。！？、；：「」『』【】（）…—～·]/g, '')
            .replace(/[\u{1F600}-\u{1F64F}]/gu, '') // emoticons
            .replace(/[\u{1F300}-\u{1F5FF}]/gu, '') // symbols & pictographs
            .replace(/[\u{1F680}-\u{1F6FF}]/gu, '') // transport & map
            .replace(/[\u{2600}-\u{26FF}]/gu, '')   // misc symbols
            .replace(/[\u{2700}-\u{27BF}]/gu, '');  // dingbats

        return cleaned.length;
    }

    /**
     * 計算 Emoji 數量
     */
    countEmojis(text: string): number {
        const emojiRegex = /[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F900}-\u{1F9FF}]|[\u{1F1E0}-\u{1F1FF}]/gu;
        const matches = text.match(emojiRegex);
        return matches ? matches.length : 0;
    }

    /**
     * 計算兩段文字的相似度（簡單版）
     */
    calculateSimilarity(text1: string, text2: string): number {
        // 使用 Jaccard 相似度
        const words1 = new Set(text1.split(''));
        const words2 = new Set(text2.split(''));

        const intersection = new Set([...words1].filter(x => words2.has(x)));
        const union = new Set([...words1, ...words2]);

        return intersection.size / union.size;
    }

    /**
     * 生成修正指令（用於重試）
     */
    generateFixPrompt(result: PostCheckResult, plan: GenerationPlan): string {
        let fixPrompt = '⚠️ 上次生成的內容有問題，請修正：\n\n';

        result.issues.forEach((issue, idx) => {
            fixPrompt += `${idx + 1}. ${issue}\n`;
        });

        fixPrompt += '\n修正建議：\n';
        result.suggestions.forEach((sug, idx) => {
            fixPrompt += `- ${sug}\n`;
        });

        fixPrompt += '\n請重新生成一篇符合要求的貼文。';

        return fixPrompt;
    }
}

export default new PostCheckService();
