/**
 * Agent API Key 驗證中間件
 * AI Agent (靈犀) 透過 x-api-key header 認證
 */

import { Request, Response, NextFunction } from 'express';
import logger from '../utils/logger';

export function agentAuth(req: Request, res: Response, next: NextFunction): void {
    const apiKey = process.env.AGENT_API_KEY;

    if (!apiKey) {
        logger.error('[AgentAuth] AGENT_API_KEY 環境變數未設定');
        res.status(500).json({ success: false, error: 'Server configuration error' });
        return;
    }

    const providedKey = req.headers['x-api-key'] as string;

    if (!providedKey || providedKey !== apiKey) {
        res.status(401).json({ success: false, error: 'Invalid or missing API key' });
        return;
    }

    next();
}
