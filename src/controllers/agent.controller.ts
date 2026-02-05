/**
 * Agent Controller
 * 供外部 AI Agent（靈犀）使用的 API handler
 */

import { Request, Response } from 'express';
import { PostModel } from '../models/post.model';
import { PostStatus, EngineType } from '../types';
import { getPool } from '../database/connection';
import { generateUUID } from '../utils/uuid';
import { RowDataPacket } from 'mysql2';
import logger from '../utils/logger';

/**
 * GET /api/agent/posts/history
 * 查詢歷史貼文（含互動數據）
 */
export async function getPostHistory(req: Request, res: Response): Promise<void> {
    try {
        const { status, limit } = req.query;
        const safeLimit = limit ? Number(limit) : 20;

        if (status && !['published', 'scheduled', 'draft'].includes(status as string)) {
            res.status(400).json({
                success: false,
                error: 'Invalid status filter. Use: published, scheduled, draft',
            });
            return;
        }

        const posts = await PostModel.getHistoryWithEngagement(
            status as string | undefined,
            safeLimit
        );

        res.json({
            success: true,
            data: posts,
            count: posts.length,
        });
    } catch (error) {
        logger.error('[Agent] getPostHistory error:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
}

/**
 * GET /api/agent/posts/top-performing
 * 高表現貼文排行
 */
export async function getTopPerforming(req: Request, res: Response): Promise<void> {
    try {
        const { limit } = req.query;
        const safeLimit = limit ? Number(limit) : 10;

        const posts = await PostModel.getTopPerforming(safeLimit);

        res.json({
            success: true,
            data: posts,
            count: posts.length,
        });
    } catch (error) {
        logger.error('[Agent] getTopPerforming error:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
}

/**
 * POST /api/agent/posts/schedule
 * 排程新貼文（支援 dry_run）
 */
export async function schedulePost(req: Request, res: Response): Promise<void> {
    try {
        if (!req.body || typeof req.body !== 'object') {
            res.status(400).json({ success: false, error: 'Request body is required (Content-Type: application/json)' });
            return;
        }

        const {
            content,
            tags,
            context,
            schedule_time,
            skip_review = false,
            dry_run = false,
        } = req.body;

        // === 驗證 ===
        const warnings: string[] = [];

        // 1. content 必填且 ≤500 字
        if (!content || typeof content !== 'string' || content.trim().length === 0) {
            res.status(400).json({ success: false, error: 'content is required' });
            return;
        }
        if (content.length > 500) {
            res.status(400).json({ success: false, error: 'content exceeds 500 characters' });
            return;
        }

        // 2. tags 驗證（須為字串陣列）
        if (tags !== undefined) {
            if (!Array.isArray(tags) || !tags.every((t: any) => typeof t === 'string')) {
                res.status(400).json({ success: false, error: 'tags must be an array of strings' });
                return;
            }
        }

        // 3. schedule_time 解析
        let scheduledDate: Date | null = null;
        if (schedule_time) {
            scheduledDate = new Date(schedule_time);
            if (isNaN(scheduledDate.getTime())) {
                res.status(400).json({ success: false, error: 'Invalid schedule_time format. Use ISO 8601 (e.g. 2026-02-10T14:00:00+08:00)' });
                return;
            }

            // 4. 拒絕過去時間，至少提前 15 分鐘
            const now = new Date();
            const minTime = new Date(now.getTime() + 15 * 60 * 1000);
            if (scheduledDate < minTime) {
                res.status(400).json({
                    success: false,
                    error: 'schedule_time must be at least 15 minutes in the future',
                });
                return;
            }

            // 5. 檢查 1 小時間隔衝突
            const pool = getPool();
            const oneHourBefore = new Date(scheduledDate.getTime() - 60 * 60 * 1000);
            const oneHourAfter = new Date(scheduledDate.getTime() + 60 * 60 * 1000);

            const [conflicts] = await pool.execute<RowDataPacket[]>(
                `SELECT id, scheduled_time FROM daily_auto_schedule
                 WHERE status IN ('PENDING', 'GENERATED', 'APPROVED', 'PUBLISHING')
                   AND scheduled_time BETWEEN ? AND ?`,
                [oneHourBefore, oneHourAfter]
            );

            if (conflicts.length > 0) {
                res.status(409).json({
                    success: false,
                    error: 'Time conflict: another post is scheduled within 1 hour of the requested time',
                    conflict: {
                        existing_schedule_id: conflicts[0].id,
                        existing_time: conflicts[0].scheduled_time,
                    },
                });
                return;
            }
        }

        // 6. 相似度檢查
        const recentPosts = await PostModel.getRecentPosted(60);
        let maxSimilarity = 0;
        let similarPostId: string | null = null;

        for (const recent of recentPosts) {
            const similarity = calculateSimilarity(content, recent.content);
            if (similarity > maxSimilarity) {
                maxSimilarity = similarity;
                similarPostId = recent.id;
            }
        }

        if (maxSimilarity > 0.85) {
            res.status(409).json({
                success: false,
                error: `Content too similar to existing post (${(maxSimilarity * 100).toFixed(1)}% similarity)`,
                similar_post_id: similarPostId,
                similarity: maxSimilarity,
            });
            return;
        }

        if (maxSimilarity > 0.70) {
            warnings.push(`Content has ${(maxSimilarity * 100).toFixed(1)}% similarity with post ${similarPostId}`);
        }

        // === dry_run 模式：只回傳驗證結果 ===
        if (dry_run) {
            res.json({
                success: true,
                dry_run: true,
                validation: {
                    content_length: content.length,
                    tags_count: tags?.length || 0,
                    scheduled_time: scheduledDate?.toISOString() || null,
                    similarity_max: maxSimilarity,
                    similar_post_id: similarPostId,
                    skip_review,
                    warnings,
                },
                message: 'Validation passed. Set dry_run=false to create the post.',
            });
            return;
        }

        // === 正式建立 ===
        const pool = getPool();

        // 取得建立者 ID
        const [users] = await pool.execute<RowDataPacket[]>(
            `SELECT u.id FROM users u
             INNER JOIN user_roles ur ON u.id = ur.user_id
             INNER JOIN roles r ON ur.role_id = r.id
             WHERE r.name IN ('content_creator', 'admin') AND u.status = 'ACTIVE'
             ORDER BY CASE r.name WHEN 'content_creator' THEN 1 WHEN 'admin' THEN 2 END
             LIMIT 1`
        );

        if (users.length === 0) {
            res.status(500).json({ success: false, error: 'No active user found to create post' });
            return;
        }

        const creatorId = users[0].id;

        // 靈犀排程 = 已審核通過，一律 APPROVED
        const postStatus = PostStatus.APPROVED;

        // 7. 寫入 posts
        const postId = generateUUID();
        await pool.execute(
            `INSERT INTO posts (id, status, created_by, tags, context, is_ai_generated)
             VALUES (?, ?, ?, ?, ?, true)`,
            [postId, postStatus, creatorId, tags ? JSON.stringify(tags) : null, context || null]
        );

        // 8. 寫入 post_revisions
        const revisionId = generateUUID();
        await pool.execute(
            `INSERT INTO post_revisions
             (id, post_id, revision_no, content, engine_used, similarity_max)
             VALUES (?, ?, 1, ?, ?, ?)`,
            [revisionId, postId, content, EngineType.MANUAL, maxSimilarity]
        );

        // 9. 寫入 daily_auto_schedule（有 schedule_time 時）
        let scheduleId: string | null = null;
        if (scheduledDate) {
            scheduleId = generateUUID();
            // 用台灣時區 (UTC+8) 計算日期，避免跨日時 UTC 日期偏移
            const taiwanTime = new Date(scheduledDate.getTime() + 8 * 60 * 60 * 1000);
            const dateStr = taiwanTime.toISOString().split('T')[0];
            await pool.execute(
                `INSERT INTO daily_auto_schedule
                 (id, schedule_date, post_id, scheduled_time, status, selection_reason, created_at)
                 VALUES (?, ?, ?, ?, 'APPROVED', ?, NOW())`,
                [
                    scheduleId,
                    dateStr,
                    postId,
                    scheduledDate,
                    'Agent（靈犀）排程',
                ]
            );
        }

        // 10. 發送 LINE 通知（純通知，不需審核）
        try {
            const lineService = (await import('../services/line.service')).default;
            const scheduleConfigService = (await import('../services/schedule-config.service')).default;
            const aiConfig = await scheduleConfigService.getConfig();

            if (aiConfig.line_user_id) {
                const [lineUsers] = await pool.execute<RowDataPacket[]>(
                    `SELECT line_user_id FROM users WHERE line_user_id = ? AND status = 'ACTIVE' LIMIT 1`,
                    [aiConfig.line_user_id]
                );

                if (lineUsers.length > 0) {
                    const preview = content.substring(0, 100);
                    const timeStr = scheduledDate
                        ? scheduledDate.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })
                        : '立即發布';
                    await lineService.sendNotification(
                        lineUsers[0].line_user_id,
                        `📝 靈犀已排程一篇新貼文（已自動核准）\n\n` +
                        `預定時間: ${timeStr}\n` +
                        `內容預覽: ${preview}${content.length > 100 ? '...' : ''}`
                    );
                }
            }
        } catch (lineError) {
            logger.warn('[Agent] Failed to send LINE notification:', lineError);
            warnings.push('LINE notification failed');
        }

        // 11. 無 schedule_time → 立即加入發布佇列
        if (!scheduledDate) {
            try {
                const queueService = (await import('../services/queue.service')).default;
                await queueService.addPublishJob({
                    postId,
                    revisionId,
                });
                await PostModel.updateStatus(postId, PostStatus.PUBLISHING);
            } catch (queueError) {
                logger.error('[Agent] Failed to queue publish job:', queueError);
                warnings.push('Failed to queue for immediate publishing');
            }
        }

        res.status(201).json({
            success: true,
            data: {
                post_id: postId,
                revision_id: revisionId,
                schedule_id: scheduleId,
                status: postStatus,
                scheduled_time: scheduledDate?.toISOString() || null,
                similarity_max: maxSimilarity,
                warnings,
            },
        });
    } catch (error) {
        logger.error('[Agent] schedulePost error:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
}

/**
 * GET /api/agent/posts/:id/status
 * 查發布狀態
 */
export async function getPostStatus(req: Request, res: Response): Promise<void> {
    try {
        const { id } = req.params;
        const post = await PostModel.getPostWithRevisionAndInsights(id);

        if (!post) {
            res.status(404).json({ success: false, error: 'Post not found' });
            return;
        }

        res.json({ success: true, data: post });
    } catch (error) {
        logger.error('[Agent] getPostStatus error:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
}

/**
 * PATCH /api/agent/posts/:id
 * 修改排程內容/時間（限 DRAFT/PENDING_REVIEW/APPROVED 狀態）
 */
export async function updateScheduledPost(req: Request, res: Response): Promise<void> {
    try {
        const { id } = req.params;
        const { content, tags, context, schedule_time } = req.body;

        const post = await PostModel.findById(id);
        if (!post) {
            res.status(404).json({ success: false, error: 'Post not found' });
            return;
        }

        const editableStatuses = [PostStatus.DRAFT, PostStatus.PENDING_REVIEW, PostStatus.APPROVED];
        if (!editableStatuses.includes(post.status)) {
            res.status(400).json({
                success: false,
                error: `Cannot edit post in ${post.status} status. Editable statuses: DRAFT, PENDING_REVIEW, APPROVED`,
            });
            return;
        }

        const pool = getPool();

        // 更新 content → 建立新 revision
        if (content) {
            if (typeof content !== 'string' || content.length > 500) {
                res.status(400).json({ success: false, error: 'content must be a string ≤500 characters' });
                return;
            }

            // 相似度檢查
            const recentPosts = await PostModel.getRecentPosted(60);
            let maxSimilarity = 0;
            for (const recent of recentPosts) {
                if (recent.id === id) continue;
                const similarity = calculateSimilarity(content, recent.content);
                if (similarity > maxSimilarity) maxSimilarity = similarity;
            }

            if (maxSimilarity > 0.85) {
                res.status(409).json({
                    success: false,
                    error: `Updated content too similar to existing post (${(maxSimilarity * 100).toFixed(1)}%)`,
                });
                return;
            }

            await PostModel.createRevision({
                post_id: id,
                content,
                engine_used: EngineType.MANUAL,
                similarity_max: maxSimilarity,
            });
        }

        // 更新 tags, context
        if (tags !== undefined || context !== undefined) {
            const updateFields: string[] = [];
            const updateValues: any[] = [];

            if (tags !== undefined) {
                if (!Array.isArray(tags) || !tags.every((t: any) => typeof t === 'string')) {
                    res.status(400).json({ success: false, error: 'tags must be an array of strings' });
                    return;
                }
                updateFields.push('tags = ?');
                updateValues.push(JSON.stringify(tags));
            }
            if (context !== undefined) {
                updateFields.push('context = ?');
                updateValues.push(context);
            }

            updateFields.push('updated_at = NOW()');
            updateValues.push(id);

            await pool.execute(
                `UPDATE posts SET ${updateFields.join(', ')} WHERE id = ?`,
                updateValues
            );
        }

        // 更新 schedule_time
        if (schedule_time) {
            const scheduledDate = new Date(schedule_time);
            if (isNaN(scheduledDate.getTime())) {
                res.status(400).json({ success: false, error: 'Invalid schedule_time format' });
                return;
            }

            const now = new Date();
            const minTime = new Date(now.getTime() + 15 * 60 * 1000);
            if (scheduledDate < minTime) {
                res.status(400).json({
                    success: false,
                    error: 'schedule_time must be at least 15 minutes in the future',
                });
                return;
            }

            // 更新或插入 daily_auto_schedule
            const [existingSchedule] = await pool.execute<RowDataPacket[]>(
                `SELECT id FROM daily_auto_schedule WHERE post_id = ? AND status != 'CANCELLED'`,
                [id]
            );

            const dateStr = scheduledDate.toISOString().split('T')[0];

            if (existingSchedule.length > 0) {
                await pool.execute(
                    `UPDATE daily_auto_schedule
                     SET scheduled_time = ?, schedule_date = ?, updated_at = NOW()
                     WHERE id = ?`,
                    [scheduledDate, dateStr, existingSchedule[0].id]
                );
            } else {
                const scheduleId = generateUUID();
                await pool.execute(
                    `INSERT INTO daily_auto_schedule
                     (id, schedule_date, post_id, scheduled_time, status, selection_reason, created_at)
                     VALUES (?, ?, ?, ?, 'APPROVED', 'Agent（靈犀）排程', NOW())`,
                    [scheduleId, dateStr, id, scheduledDate]
                );
            }
        }

        // 回傳更新後的完整資料
        const updated = await PostModel.getPostWithRevisionAndInsights(id);
        res.json({ success: true, data: updated });
    } catch (error) {
        logger.error('[Agent] updateScheduledPost error:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
}

/**
 * DELETE /api/agent/posts/:id/schedule
 * 取消排程
 */
export async function cancelSchedule(req: Request, res: Response): Promise<void> {
    try {
        const { id } = req.params;

        const post = await PostModel.findById(id);
        if (!post) {
            res.status(404).json({ success: false, error: 'Post not found' });
            return;
        }

        // 只能取消尚未發布的貼文
        if (post.status === PostStatus.POSTED || post.status === PostStatus.PUBLISHING) {
            res.status(400).json({
                success: false,
                error: `Cannot cancel: post is already ${post.status}`,
            });
            return;
        }

        const pool = getPool();

        // 更新 post 狀態為 SKIPPED
        await PostModel.updateStatus(id, PostStatus.SKIPPED);

        // 更新排程狀態為 CANCELLED
        await pool.execute(
            `UPDATE daily_auto_schedule
             SET status = 'CANCELLED', updated_at = NOW()
             WHERE post_id = ? AND status IN ('PENDING', 'GENERATED', 'APPROVED')`,
            [id]
        );

        res.json({
            success: true,
            message: 'Schedule cancelled',
            data: { post_id: id, status: PostStatus.SKIPPED },
        });
    } catch (error) {
        logger.error('[Agent] cancelSchedule error:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
}

/**
 * GET /api/agent/schedule/available-slots
 * 查可用時段
 */
export async function getAvailableSlots(req: Request, res: Response): Promise<void> {
    try {
        const { date } = req.query;

        // 預設查詢日期為今天
        const queryDate = date ? String(date) : new Date().toISOString().split('T')[0];

        // 驗證日期格式
        if (!/^\d{4}-\d{2}-\d{2}$/.test(queryDate)) {
            res.status(400).json({ success: false, error: 'Invalid date format. Use YYYY-MM-DD' });
            return;
        }

        const pool = getPool();

        // 取得 smart_schedule_config 的時間範圍
        let timeRangeStart = '09:00';
        let timeRangeEnd = '21:00';

        try {
            const scheduleConfigService = (await import('../services/schedule-config.service')).default;
            const config = await scheduleConfigService.getConfig();
            if (config.time_range_start) timeRangeStart = config.time_range_start.substring(0, 5);
            if (config.time_range_end) timeRangeEnd = config.time_range_end.substring(0, 5);
        } catch {
            // 使用預設值
        }

        // 取得該日已排程的時間
        const [scheduled] = await pool.execute<RowDataPacket[]>(
            `SELECT scheduled_time, status, post_id
             FROM daily_auto_schedule
             WHERE schedule_date = ?
               AND status IN ('PENDING', 'GENERATED', 'APPROVED', 'PUBLISHING')
             ORDER BY scheduled_time ASC`,
            [queryDate]
        );

        // 取得 Threads token 狀態
        let tokenStatus = 'unknown';
        try {
            const [tokens] = await pool.execute<RowDataPacket[]>(
                `SELECT ta.status as auth_status, ta.expires_at
                 FROM threads_auth ta
                 INNER JOIN threads_accounts acc ON ta.account_id = acc.id
                 WHERE acc.status = 'ACTIVE'
                 LIMIT 1`
            );

            if (tokens.length > 0) {
                const token = tokens[0];
                if (token.auth_status === 'OK' && new Date(token.expires_at) > new Date()) {
                    tokenStatus = 'active';
                } else if (new Date(token.expires_at) <= new Date()) {
                    tokenStatus = 'expired';
                } else {
                    tokenStatus = token.auth_status.toLowerCase();
                }
            } else {
                tokenStatus = 'no_account';
            }
        } catch {
            // 忽略
        }

        // 生成可用時段（以 1 小時為單位）
        const [startH, startM] = timeRangeStart.split(':').map(Number);
        const [endH, endM] = timeRangeEnd.split(':').map(Number);
        const slots: Array<{ time: string; available: boolean; conflict_with?: string }> = [];

        for (let h = startH; h <= endH; h++) {
            const slotTime = `${String(h).padStart(2, '0')}:00`;
            const slotDate = new Date(`${queryDate}T${slotTime}:00+08:00`);

            // 檢查是否與已排程衝突（1 小時內）
            let conflictId: string | null = null;
            for (const s of scheduled) {
                const diff = Math.abs(new Date(s.scheduled_time).getTime() - slotDate.getTime());
                if (diff < 60 * 60 * 1000) {
                    conflictId = s.post_id;
                    break;
                }
            }

            slots.push({
                time: slotTime,
                available: !conflictId,
                ...(conflictId ? { conflict_with: conflictId } : {}),
            });
        }

        res.json({
            success: true,
            data: {
                date: queryDate,
                time_range: { start: timeRangeStart, end: timeRangeEnd },
                token_status: tokenStatus,
                scheduled_posts: scheduled.map(s => ({
                    post_id: s.post_id,
                    scheduled_time: s.scheduled_time,
                    status: s.status,
                })),
                available_slots: slots,
            },
        });
    } catch (error) {
        logger.error('[Agent] getAvailableSlots error:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
}

/**
 * 簡易文字相似度計算（基於 bigram）
 * 用於快速檢查，不需要向量 embeddings
 */
function calculateSimilarity(text1: string, text2: string): number {
    if (!text1 || !text2) return 0;

    const getBigrams = (text: string): Set<string> => {
        const bigrams = new Set<string>();
        const cleaned = text.replace(/\s+/g, '');
        for (let i = 0; i < cleaned.length - 1; i++) {
            bigrams.add(cleaned.substring(i, i + 2));
        }
        return bigrams;
    };

    const bigrams1 = getBigrams(text1);
    const bigrams2 = getBigrams(text2);

    let intersection = 0;
    for (const bg of bigrams1) {
        if (bigrams2.has(bg)) intersection++;
    }

    const union = bigrams1.size + bigrams2.size - intersection;
    return union === 0 ? 0 : intersection / union;
}
