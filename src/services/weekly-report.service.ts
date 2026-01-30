/**
 * 聲量週報服務
 * 每週統計提及數據，提取熱門關鍵詞，發送報告
 */

import { getPool } from '../database/connection';
import { RowDataPacket } from 'mysql2';
import logger from '../utils/logger';

interface BrandStats {
    brand_id: string;
    brand_name: string;
    mention_count: number;
    prev_week_count: number;
    change_percent: number;
}

interface SourceStats {
    source_id: string;
    source_name: string;
    platform: string;
    mention_count: number;
}

interface TopKeyword {
    keyword: string;
    count: number;
}

interface WeeklyReportData {
    period: {
        start: string;
        end: string;
    };
    summary: {
        total_mentions: number;
        prev_week_mentions: number;
        change_percent: number;
        total_sources_checked: number;
    };
    by_brand: BrandStats[];
    by_source: SourceStats[];
    top_keywords: TopKeyword[];
    top_titles: Array<{ title: string; brand: string; url: string }>;
}

class WeeklyReportService {
    /**
     * 產生週報數據
     */
    async generateReport(weeksAgo: number = 0): Promise<WeeklyReportData> {
        const pool = getPool();

        // 計算日期範圍（本週日到週六，或往前推幾週）
        const now = new Date();
        const dayOfWeek = now.getDay(); // 0 = Sunday

        // 本週的起始日（上週日）
        const weekEnd = new Date(now);
        weekEnd.setDate(now.getDate() - dayOfWeek - (weeksAgo * 7));
        weekEnd.setHours(23, 59, 59, 999);

        const weekStart = new Date(weekEnd);
        weekStart.setDate(weekEnd.getDate() - 6);
        weekStart.setHours(0, 0, 0, 0);

        // 上週的範圍（用於比較）
        const prevWeekEnd = new Date(weekStart);
        prevWeekEnd.setDate(weekStart.getDate() - 1);
        prevWeekEnd.setHours(23, 59, 59, 999);

        const prevWeekStart = new Date(prevWeekEnd);
        prevWeekStart.setDate(prevWeekEnd.getDate() - 6);
        prevWeekStart.setHours(0, 0, 0, 0);

        const startStr = weekStart.toISOString().slice(0, 10);
        const endStr = weekEnd.toISOString().slice(0, 10);
        const prevStartStr = prevWeekStart.toISOString().slice(0, 10);
        const prevEndStr = prevWeekEnd.toISOString().slice(0, 10);

        logger.info(`[WeeklyReport] 產生週報: ${startStr} ~ ${endStr}`);

        // 1. 本週總提及數
        const [totalRows] = await pool.execute<RowDataPacket[]>(
            `SELECT COUNT(*) as count FROM monitor_mentions
             WHERE created_at >= ? AND created_at <= ?`,
            [startStr, endStr + ' 23:59:59']
        );
        const totalMentions = totalRows[0]?.count || 0;

        // 2. 上週總提及數
        const [prevTotalRows] = await pool.execute<RowDataPacket[]>(
            `SELECT COUNT(*) as count FROM monitor_mentions
             WHERE created_at >= ? AND created_at <= ?`,
            [prevStartStr, prevEndStr + ' 23:59:59']
        );
        const prevWeekMentions = prevTotalRows[0]?.count || 0;

        // 3. 各品牌統計
        const [brandRows] = await pool.execute<RowDataPacket[]>(
            `SELECT
                mm.brand_id,
                mb.name as brand_name,
                COUNT(*) as mention_count
             FROM monitor_mentions mm
             JOIN monitor_brands mb ON mm.brand_id = mb.id
             WHERE mm.created_at >= ? AND mm.created_at <= ?
             GROUP BY mm.brand_id, mb.name
             ORDER BY mention_count DESC`,
            [startStr, endStr + ' 23:59:59']
        );

        // 取得上週各品牌數據用於比較
        const [prevBrandRows] = await pool.execute<RowDataPacket[]>(
            `SELECT brand_id, COUNT(*) as count
             FROM monitor_mentions
             WHERE created_at >= ? AND created_at <= ?
             GROUP BY brand_id`,
            [prevStartStr, prevEndStr + ' 23:59:59']
        );
        const prevBrandMap = new Map(prevBrandRows.map(r => [r.brand_id, r.count]));

        const byBrand: BrandStats[] = brandRows.map(row => {
            const prevCount = prevBrandMap.get(row.brand_id) || 0;
            const changePercent = prevCount > 0
                ? Math.round(((row.mention_count - prevCount) / prevCount) * 100)
                : (row.mention_count > 0 ? 100 : 0);

            return {
                brand_id: row.brand_id,
                brand_name: row.brand_name,
                mention_count: row.mention_count,
                prev_week_count: prevCount,
                change_percent: changePercent,
            };
        });

        // 4. 各來源統計
        const [sourceRows] = await pool.execute<RowDataPacket[]>(
            `SELECT
                mm.source_id,
                ms.name as source_name,
                ms.platform,
                COUNT(*) as mention_count
             FROM monitor_mentions mm
             JOIN monitor_sources ms ON mm.source_id = ms.id
             WHERE mm.created_at >= ? AND mm.created_at <= ?
             GROUP BY mm.source_id, ms.name, ms.platform
             ORDER BY mention_count DESC`,
            [startStr, endStr + ' 23:59:59']
        );

        const bySource: SourceStats[] = sourceRows.map(row => ({
            source_id: row.source_id,
            source_name: row.source_name,
            platform: row.platform,
            mention_count: row.mention_count,
        }));

        // 5. 來源檢查次數
        const [checkRows] = await pool.execute<RowDataPacket[]>(
            `SELECT COUNT(DISTINCT source_id) as count FROM monitor_mentions
             WHERE created_at >= ? AND created_at <= ?`,
            [startStr, endStr + ' 23:59:59']
        );
        const sourcesChecked = checkRows[0]?.count || 0;

        // 6. 熱門關鍵詞（從標題提取）
        const topKeywords = await this.extractTopKeywords(startStr, endStr + ' 23:59:59');

        // 7. 熱門文章標題
        const [titleRows] = await pool.execute<RowDataPacket[]>(
            `SELECT mm.title, mb.name as brand, mm.url
             FROM monitor_mentions mm
             JOIN monitor_brands mb ON mm.brand_id = mb.id
             WHERE mm.created_at >= ? AND mm.created_at <= ?
               AND mm.title IS NOT NULL AND mm.title != ''
             ORDER BY (mm.likes_count + mm.comments_count) DESC
             LIMIT 10`,
            [startStr, endStr + ' 23:59:59']
        );

        const topTitles = titleRows.map(row => ({
            title: row.title,
            brand: row.brand,
            url: row.url,
        }));

        // 計算總變化百分比
        const totalChangePercent = prevWeekMentions > 0
            ? Math.round(((totalMentions - prevWeekMentions) / prevWeekMentions) * 100)
            : (totalMentions > 0 ? 100 : 0);

        return {
            period: { start: startStr, end: endStr },
            summary: {
                total_mentions: totalMentions,
                prev_week_mentions: prevWeekMentions,
                change_percent: totalChangePercent,
                total_sources_checked: sourcesChecked,
            },
            by_brand: byBrand,
            by_source: bySource,
            top_keywords: topKeywords,
            top_titles: topTitles,
        };
    }

    /**
     * 從標題提取熱門關鍵詞
     */
    private async extractTopKeywords(startDate: string, endDate: string): Promise<TopKeyword[]> {
        const pool = getPool();

        // 取得所有標題
        const [rows] = await pool.execute<RowDataPacket[]>(
            `SELECT title FROM monitor_mentions
             WHERE created_at >= ? AND created_at <= ?
               AND title IS NOT NULL AND title != ''`,
            [startDate, endDate]
        );

        // 簡易中文分詞（用常見詞彙匹配）
        const keywordPatterns = [
            // 產品相關
            '推薦', '好用', '便宜', '平價', 'CP值', '入門',
            '新手', '第一次', '請益', '求推', '選擇',
            // 情緒相關
            '讚', '推', '好評', '雷', '不推', '踩雷', '失望',
            // 需求相關
            '想買', '想問', '有人', '用過', '經驗', '分享',
            // 產品類型（可依業務擴充）
            '按摩', '情趣', '玩具', '潤滑', '保險套', '飛機杯',
        ];

        const keywordCounts = new Map<string, number>();

        for (const row of rows) {
            const title = row.title as string;
            for (const keyword of keywordPatterns) {
                if (title.includes(keyword)) {
                    keywordCounts.set(keyword, (keywordCounts.get(keyword) || 0) + 1);
                }
            }
        }

        // 排序並取 Top 15
        const sorted = Array.from(keywordCounts.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 15)
            .map(([keyword, count]) => ({ keyword, count }));

        return sorted;
    }

    /**
     * 格式化週報為文字（用於 LINE 發送）
     */
    formatReportForLine(report: WeeklyReportData): string {
        const { period, summary, by_brand, by_source, top_keywords } = report;

        let text = `📊 聲量週報\n`;
        text += `📅 ${period.start} ~ ${period.end}\n\n`;

        // 總覽
        const changeIcon = summary.change_percent >= 0 ? '📈' : '📉';
        const changeText = summary.change_percent >= 0
            ? `+${summary.change_percent}%`
            : `${summary.change_percent}%`;

        text += `【總覽】\n`;
        text += `提及數: ${summary.total_mentions} 篇 ${changeIcon}${changeText}\n`;
        text += `(上週: ${summary.prev_week_mentions} 篇)\n\n`;

        // 各品牌
        if (by_brand.length > 0) {
            text += `【品牌聲量】\n`;
            for (const brand of by_brand.slice(0, 5)) {
                const icon = brand.change_percent >= 0 ? '↑' : '↓';
                text += `• ${brand.brand_name}: ${brand.mention_count} 篇 ${icon}${Math.abs(brand.change_percent)}%\n`;
            }
            text += `\n`;
        }

        // 各來源
        if (by_source.length > 0) {
            text += `【來源分布】\n`;
            for (const source of by_source.slice(0, 5)) {
                text += `• ${source.source_name}: ${source.mention_count} 篇\n`;
            }
            text += `\n`;
        }

        // 熱門關鍵詞
        if (top_keywords.length > 0) {
            text += `【熱門關鍵詞】\n`;
            const keywordList = top_keywords.slice(0, 10).map(k => k.keyword).join('、');
            text += keywordList + `\n`;
        }

        return text;
    }

    /**
     * 發送週報到 LINE
     */
    async sendReportToLine(report: WeeklyReportData): Promise<boolean> {
        try {
            const pool = getPool();

            // 取得 LINE 設定
            const [settings] = await pool.execute<RowDataPacket[]>(
                `SELECT line_user_id, line_channel_token FROM settings WHERE id = 1`
            );

            if (!settings[0]?.line_user_id || !settings[0]?.line_channel_token) {
                logger.warn('[WeeklyReport] LINE 未設定，無法發送週報');
                return false;
            }

            const { line_user_id, line_channel_token } = settings[0];
            const message = this.formatReportForLine(report);

            const response = await fetch('https://api.line.me/v2/bot/message/push', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${line_channel_token}`,
                },
                body: JSON.stringify({
                    to: line_user_id,
                    messages: [{ type: 'text', text: message }],
                }),
            });

            if (!response.ok) {
                const errorText = await response.text();
                logger.error(`[WeeklyReport] LINE 發送失敗: ${errorText}`);
                return false;
            }

            logger.info('[WeeklyReport] 週報已發送到 LINE');
            return true;
        } catch (error) {
            logger.error('[WeeklyReport] 發送週報失敗:', error);
            return false;
        }
    }
}

export default new WeeklyReportService();
