/**
 * Scraper API Key 驗證中間件
 * 本機爬蟲透過 x-scraper-key header 認證
 */

import { Request, Response, NextFunction } from 'express';
import logger from '../utils/logger';

export function scraperAuth(req: Request, res: Response, next: NextFunction): void {
    const apiKey = process.env.SCRAPER_API_KEY;

    if (!apiKey) {
        logger.error('[ScraperAuth] SCRAPER_API_KEY 環境變數未設定');
        res.status(500).json({ success: false, error: 'Server configuration error' });
        return;
    }

    const providedKey = req.headers['x-scraper-key'] as string;

    if (!providedKey || providedKey !== apiKey) {
        res.status(401).json({ success: false, error: 'Invalid scraper API key' });
        return;
    }

    next();
}
