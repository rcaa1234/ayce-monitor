declare module 'google-trends-api' {
    interface InterestOverTimeOptions {
        keyword: string | string[];
        startTime?: Date;
        endTime?: Date;
        geo?: string;
        hl?: string;
        timezone?: number;
        category?: number;
        property?: string;
        granularTimeResolution?: boolean;
    }

    interface RelatedQueriesOptions {
        keyword: string | string[];
        startTime?: Date;
        endTime?: Date;
        geo?: string;
        hl?: string;
        timezone?: number;
        category?: number;
    }

    interface InterestByRegionOptions {
        keyword: string | string[];
        startTime?: Date;
        endTime?: Date;
        geo?: string;
        hl?: string;
        timezone?: number;
        resolution?: string;
        category?: number;
    }

    interface DailyTrendsOptions {
        trendDate?: Date;
        geo?: string;
        hl?: string;
    }

    interface RealTimeTrendsOptions {
        geo?: string;
        hl?: string;
        timezone?: number;
        category?: string;
    }

    function interestOverTime(options: InterestOverTimeOptions): Promise<string>;
    function relatedQueries(options: RelatedQueriesOptions): Promise<string>;
    function relatedTopics(options: RelatedQueriesOptions): Promise<string>;
    function interestByRegion(options: InterestByRegionOptions): Promise<string>;
    function dailyTrends(options: DailyTrendsOptions): Promise<string>;
    function realTimeTrends(options: RealTimeTrendsOptions): Promise<string>;
    function autoComplete(options: { keyword: string; hl?: string }): Promise<string>;

    export default {
        interestOverTime,
        relatedQueries,
        relatedTopics,
        interestByRegion,
        dailyTrends,
        realTimeTrends,
        autoComplete,
    };
}
