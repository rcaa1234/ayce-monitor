/**
 * Google Trends 服務
 * 抓取關鍵字搜尋趨勢數據
 */

import googleTrends from 'google-trends-api';
import { getPool } from '../database/connection';
import { RowDataPacket } from 'mysql2';
import logger from '../utils/logger';
import { generateUUID } from '../utils/uuid';

interface TrendResult {
    keyword: string;
    date: string;
    value: number;
    formattedDate: string;
}

interface RelatedQuery {
    query: string;
    value: number | string;
    type: 'top' | 'rising';
}

interface RegionBreakdown {
    geoCode: string;
    geoName: string;
    value: number;
}

class TrendsService {
    /**
     * 取得關鍵字的搜尋趨勢
     */
    async getInterestOverTime(
        keywords: string[],
        geo: string = 'TW',
        startTime?: Date,
        endTime?: Date
    ): Promise<TrendResult[]> {
        try {
            const now = new Date();
            const defaultStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); // 30 days ago

            const result = await googleTrends.interestOverTime({
                keyword: keywords,
                geo,
                startTime: startTime || defaultStart,
                endTime: endTime || now,
            });

            const data = JSON.parse(result);
            const timelineData = data.default?.timelineData || [];

            const trends: TrendResult[] = [];

            for (const point of timelineData) {
                const date = new Date(point.time * 1000);
                const formattedDate = date.toISOString().split('T')[0];

                keywords.forEach((keyword, index) => {
                    trends.push({
                        keyword,
                        date: formattedDate,
                        value: point.value[index] || 0,
                        formattedDate: point.formattedTime,
                    });
                });
            }

            return trends;
        } catch (error: any) {
            logger.error('Failed to get interest over time:', error);
            throw error;
        }
    }

    /**
     * 取得相關搜尋詞
     */
    async getRelatedQueries(
        keyword: string,
        geo: string = 'TW'
    ): Promise<{ top: RelatedQuery[]; rising: RelatedQuery[] }> {
        try {
            const result = await googleTrends.relatedQueries({
                keyword,
                geo,
            });

            const data = JSON.parse(result);
            const defaultData = data.default || {};

            const topQueries = (defaultData.rankedList?.[0]?.rankedKeyword || []).map(
                (item: any) => ({
                    query: item.query,
                    value: item.value,
                    type: 'top' as const,
                })
            );

            const risingQueries = (defaultData.rankedList?.[1]?.rankedKeyword || []).map(
                (item: any) => ({
                    query: item.query,
                    value: item.formattedValue || item.value,
                    type: 'rising' as const,
                })
            );

            return { top: topQueries, rising: risingQueries };
        } catch (error: any) {
            logger.error('Failed to get related queries:', error);
            return { top: [], rising: [] };
        }
    }

    /**
     * 取得地區分佈
     */
    async getInterestByRegion(
        keyword: string,
        geo: string = 'TW'
    ): Promise<RegionBreakdown[]> {
        try {
            const result = await googleTrends.interestByRegion({
                keyword,
                geo,
                resolution: 'CITY',
            });

            const data = JSON.parse(result);
            const geoMapData = data.default?.geoMapData || [];

            return geoMapData.map((item: any) => ({
                geoCode: item.geoCode,
                geoName: item.geoName,
                value: item.value[0] || 0,
            }));
        } catch (error: any) {
            logger.error('Failed to get interest by region:', error);
            return [];
        }
    }

    /**
     * 即時熱門搜尋
     */
    async getDailyTrends(geo: string = 'TW'): Promise<any[]> {
        try {
            const result = await googleTrends.dailyTrends({
                geo,
            });

            const data = JSON.parse(result);
            const trendingSearches =
                data.default?.trendingSearchesDays?.[0]?.trendingSearches || [];

            return trendingSearches.map((item: any) => ({
                title: item.title?.query,
                traffic: item.formattedTraffic,
                articles: item.articles?.map((a: any) => ({
                    title: a.title,
                    url: a.url,
                    source: a.source,
                })),
            }));
        } catch (error: any) {
            logger.error('Failed to get daily trends:', error);
            return [];
        }
    }

    /**
     * 儲存趨勢數據到資料庫
     */
    async saveTrendData(
        brandId: string,
        keyword: string,
        trends: TrendResult[],
        relatedQueries?: { top: RelatedQuery[]; rising: RelatedQuery[] },
        regionBreakdown?: RegionBreakdown[]
    ): Promise<void> {
        const pool = getPool();

        for (const trend of trends) {
            if (trend.keyword !== keyword) continue;

            const id = generateUUID();

            try {
                await pool.execute(
                    `INSERT INTO monitor_trends (
            id, brand_id, source, keyword, trend_date, trend_value,
            region, region_breakdown, related_queries, rising_queries, fetched_at
          ) VALUES (?, ?, 'google_trends', ?, ?, ?, 'TW', ?, ?, ?, NOW())
          ON DUPLICATE KEY UPDATE 
            trend_value = VALUES(trend_value),
            region_breakdown = VALUES(region_breakdown),
            related_queries = VALUES(related_queries),
            rising_queries = VALUES(rising_queries),
            fetched_at = NOW()`,
                    [
                        id,
                        brandId,
                        keyword,
                        trend.date,
                        trend.value,
                        regionBreakdown ? JSON.stringify(regionBreakdown) : null,
                        relatedQueries?.top ? JSON.stringify(relatedQueries.top) : null,
                        relatedQueries?.rising ? JSON.stringify(relatedQueries.rising) : null,
                    ]
                );
            } catch (error: any) {
                // 忽略重複鍵錯誤
                if (error.code !== 'ER_DUP_ENTRY') {
                    logger.error('Failed to save trend data:', error);
                }
            }
        }
    }

    /**
     * 為所有品牌抓取趨勢數據
     */
    async fetchTrendsForAllBrands(): Promise<void> {
        const pool = getPool();

        try {
            // 取得所有啟用的品牌
            const [brands] = await pool.execute<RowDataPacket[]>(
                `SELECT id, name, keywords FROM monitor_brands WHERE is_active = true`
            );

            if (brands.length === 0) {
                logger.info('[Trends] No active brands found');
                return;
            }

            logger.info(`[Trends] Fetching trends for ${brands.length} brands`);

            for (const brand of brands) {
                const keywords = JSON.parse(brand.keywords || '[]');
                if (keywords.length === 0) continue;

                // 取第一個關鍵字作為主要搜尋詞
                const mainKeyword = keywords[0];

                try {
                    logger.info(`[Trends] Fetching data for "${mainKeyword}"`);

                    // 取得趨勢數據
                    const trends = await this.getInterestOverTime([mainKeyword], 'TW');

                    // 取得相關搜尋（只在有趨勢時）
                    let relatedQueries;
                    let regionBreakdown;

                    if (trends.length > 0) {
                        relatedQueries = await this.getRelatedQueries(mainKeyword, 'TW');
                        regionBreakdown = await this.getInterestByRegion(mainKeyword, 'TW');
                    }

                    // 儲存數據
                    await this.saveTrendData(
                        brand.id,
                        mainKeyword,
                        trends,
                        relatedQueries,
                        regionBreakdown
                    );

                    logger.info(`[Trends] Saved ${trends.length} data points for "${mainKeyword}"`);

                    // 避免請求過快
                    await new Promise((resolve) => setTimeout(resolve, 2000));
                } catch (error: any) {
                    logger.error(`[Trends] Failed to fetch trends for "${mainKeyword}":`, error.message);
                }
            }

            logger.info('[Trends] Finished fetching all trends');
        } catch (error: any) {
            logger.error('[Trends] Failed to fetch trends for brands:', error);
        }
    }

    /**
     * 取得品牌的趨勢數據
     */
    async getBrandTrends(
        brandId: string,
        days: number = 30
    ): Promise<any[]> {
        const pool = getPool();

        const [rows] = await pool.execute<RowDataPacket[]>(
            `SELECT * FROM monitor_trends 
       WHERE brand_id = ? AND trend_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
       ORDER BY trend_date DESC`,
            [brandId, days]
        );

        return rows as any[];
    }

    /**
     * 比較多個品牌的趨勢
     */
    async compareBrandTrends(
        brandIds: string[],
        days: number = 30
    ): Promise<any> {
        const pool = getPool();
        const placeholders = brandIds.map(() => '?').join(',');

        const [rows] = await pool.execute<RowDataPacket[]>(
            `SELECT mt.*, mb.name as brand_name, mb.display_color
       FROM monitor_trends mt
       INNER JOIN monitor_brands mb ON mt.brand_id = mb.id
       WHERE mt.brand_id IN (${placeholders}) 
         AND mt.trend_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
       ORDER BY mt.trend_date, mb.name`,
            [...brandIds, days]
        );

        // 按日期分組
        const byDate: { [date: string]: any } = {};
        for (const row of rows) {
            const date = row.trend_date.toISOString().split('T')[0];
            if (!byDate[date]) {
                byDate[date] = { date, brands: {} };
            }
            byDate[date].brands[row.brand_name] = {
                value: row.trend_value,
                color: row.display_color,
            };
        }

        return Object.values(byDate);
    }
}

export default new TrendsService();
