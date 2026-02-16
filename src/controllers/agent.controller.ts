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
import { createHash } from 'crypto';
import logger from '../utils/logger';
import classifierService from '../services/classifier.service';

/**
 * GET /api/agent/posts/history
 * 查詢歷史貼文（含互動數據）
 */
export async function getPostHistory(req: Request, res: Response): Promise<void> {
    try {
        const { status, limit, ai_generated } = req.query;
        const safeLimit = limit ? Number(limit) : 20;

        if (status && !['published', 'scheduled', 'draft'].includes(status as string)) {
            res.status(400).json({
                success: false,
                error: 'Invalid status filter. Use: published, scheduled, draft',
            });
            return;
        }

        // ai_generated: 'true' | 'false' | undefined
        const aiGeneratedFilter = ai_generated === 'true' ? true
            : ai_generated === 'false' ? false
            : undefined;

        const posts = await PostModel.getHistoryWithEngagement(
            status as string | undefined,
            safeLimit,
            aiGeneratedFilter
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
 * POST /api/agent/dcard/mentions
 * 接收 Dcard 關鍵字命中的文章
 * 重複資料依 content_hash + brand_id 判斷，重複時更新互動數據
 */
export async function receiveMentions(req: Request, res: Response): Promise<void> {
    try {
        const { mentions } = req.body;

        if (!Array.isArray(mentions) || mentions.length === 0) {
            res.status(400).json({ success: false, error: 'mentions must be a non-empty array' });
            return;
        }

        const pool = getPool();
        let saved = 0;
        let updated = 0;
        let skipped = 0;

        for (const mention of mentions) {
            try {
                const {
                    source_id, brand_id, url, title, content, author_name, published_at,
                    likes_count, comments_count, external_id, matched_keywords, keyword_count, match_location,
                } = mention;

                // 計算 content_hash（SHA256 of url|title）
                const hashContent = `${url}|${title || ''}`;
                const contentHash = createHash('sha256').update(hashContent).digest('hex').substring(0, 64);

                // 檢查重複
                const [existing] = await pool.execute<RowDataPacket[]>(
                    `SELECT id, likes_count, comments_count FROM monitor_mentions WHERE content_hash = ? AND brand_id = ? LIMIT 1`,
                    [contentHash, brand_id]
                );

                if (existing.length > 0) {
                    // 重複資料：檢查互動數據是否有更新
                    const oldLikes = existing[0].likes_count || 0;
                    const oldComments = existing[0].comments_count || 0;
                    const newLikes = likes_count || 0;
                    const newComments = comments_count || 0;

                    if (newLikes !== oldLikes || newComments !== oldComments) {
                        const engagementScore = newLikes + newComments * 2;
                        await pool.execute(
                            `UPDATE monitor_mentions
                             SET likes_count = ?, comments_count = ?, engagement_score = ?, is_high_engagement = ?, updated_at = NOW()
                             WHERE id = ?`,
                            [newLikes, newComments, engagementScore, engagementScore >= 50, existing[0].id]
                        );
                        updated++;
                    } else {
                        skipped++;
                    }
                    continue;
                }

                // 建立 crawl log
                const crawlLogId = generateUUID();
                await pool.execute(
                    `INSERT INTO monitor_crawl_logs (id, source_id, started_at, completed_at, status, articles_found, new_mentions)
                     VALUES (?, ?, NOW(), NOW(), 'completed', 1, 1)`,
                    [crawlLogId, source_id]
                );

                // 執行分類
                const textToClassify = `${title || ''} ${content || ''}`;
                const classification = classifierService.classify(textToClassify);

                // 計算互動分數
                const engagementScore = (likes_count || 0) + (comments_count || 0) * 2;

                const id = generateUUID();
                await pool.execute(
                    `INSERT INTO monitor_mentions (
                        id, source_id, brand_id, crawl_log_id,
                        external_id, url, title, content, content_preview,
                        content_length, content_hash,
                        author_name, matched_keywords, keyword_count, match_location,
                        likes_count, comments_count, engagement_score, is_high_engagement,
                        published_at, discovered_at,
                        primary_topic, topics, classification_hits, classification_version, has_strong_hit
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?, ?, ?, ?)`,
                    [
                        id, source_id, brand_id, crawlLogId,
                        external_id, url, title, content, content?.substring(0, 500) || null,
                        content?.length || 0, contentHash,
                        author_name, JSON.stringify(matched_keywords || []), keyword_count || 0, match_location || 'content',
                        likes_count || 0, comments_count || 0, engagementScore, engagementScore >= 50,
                        published_at ? new Date(published_at) : null,
                        classification.primary_topic,
                        JSON.stringify(classification.topics),
                        JSON.stringify(classification.hits),
                        classification.version,
                        classification.hits.length > 0,
                    ]
                );

                saved++;
            } catch (err) {
                logger.error('[Agent] 儲存 mention 失敗:', err);
            }
        }

        // 更新來源的 last_checked_at
        const sourceIds = [...new Set(mentions.map((m: any) => m.source_id).filter(Boolean))];
        for (const sourceId of sourceIds) {
            await pool.execute(
                `UPDATE monitor_sources SET last_checked_at = NOW() WHERE id = ?`,
                [sourceId]
            ).catch(() => {});
        }

        logger.info(`[Agent] 接收 mentions: ${saved} 新增, ${updated} 更新, ${skipped} 跳過`);
        res.json({ success: true, data: { saved, updated, skipped, total: mentions.length } });
    } catch (error) {
        logger.error('[Agent] 接收 mentions 失敗:', error);
        res.status(500).json({ success: false, error: 'Failed to receive mentions' });
    }
}

/**
 * GET /api/agent/monitor/keywords
 * 取得所有監控關鍵字設定（品牌關鍵字 + 網黃偵測設定）
 * 供 Agent 完整了解需要監控的關鍵字與來源
 */
export async function getMonitorKeywords(req: Request, res: Response): Promise<void> {
    try {
        const pool = getPool();

        // 1. 取得所有啟用中的品牌及其關鍵字
        const [brands] = await pool.execute<RowDataPacket[]>(
            `SELECT id, name, short_name, brand_type, category, keywords, keyword_groups,
                    exclude_keywords, hashtags, is_active, display_color
             FROM monitor_brands
             WHERE is_active = true
             ORDER BY display_order, created_at DESC`
        );

        // 解析 JSON 欄位
        const parsedBrands = brands.map((b: any) => {
            const parseJson = (val: any) => {
                if (!val) return [];
                if (Array.isArray(val)) return val;
                if (typeof val === 'string') {
                    try { return JSON.parse(val); } catch { return []; }
                }
                return val;
            };
            return {
                id: b.id,
                name: b.name,
                short_name: b.short_name,
                brand_type: b.brand_type,
                category: b.category,
                keywords: parseJson(b.keywords),
                keyword_groups: parseJson(b.keyword_groups),
                exclude_keywords: parseJson(b.exclude_keywords),
                hashtags: parseJson(b.hashtags),
                display_color: b.display_color,
            };
        });

        // 2. 取得所有啟用中的監控來源及其品牌關聯
        const [sources] = await pool.execute<RowDataPacket[]>(
            `SELECT ms.id, ms.name, ms.url, ms.platform, ms.source_type, ms.search_query,
                    ms.check_interval_hours, ms.is_active, ms.health_status,
                    ms.last_checked_at, ms.last_success_at
             FROM monitor_sources ms
             WHERE ms.is_active = true
             ORDER BY ms.platform, ms.name`
        );

        // 3. 取得品牌與來源的關聯（含來源專用關鍵字）
        const [brandSources] = await pool.execute<RowDataPacket[]>(
            `SELECT mbs.brand_id, mbs.source_id, mbs.custom_keywords, mbs.priority,
                    mb.name as brand_name, ms.name as source_name
             FROM monitor_brand_sources mbs
             INNER JOIN monitor_brands mb ON mb.id = mbs.brand_id AND mb.is_active = true
             INNER JOIN monitor_sources ms ON ms.id = mbs.source_id AND ms.is_active = true
             ORDER BY mbs.priority DESC`
        );

        const parsedBrandSources = brandSources.map((bs: any) => ({
            brand_id: bs.brand_id,
            brand_name: bs.brand_name,
            source_id: bs.source_id,
            source_name: bs.source_name,
            custom_keywords: bs.custom_keywords ? (typeof bs.custom_keywords === 'string' ? (() => { try { return JSON.parse(bs.custom_keywords); } catch { return []; } })() : bs.custom_keywords) : [],
            priority: bs.priority,
        }));

        // 4. 取得網黃偵測設定
        const [influencerConfigs] = await pool.execute<RowDataPacket[]>(
            `SELECT enabled, detection_source, check_interval_minutes, max_posts_per_check,
                    target_forums, min_likes, keyword_filters, exclude_keywords,
                    twitter_patterns, notify_on_new, last_check_at
             FROM influencer_detection_config
             LIMIT 1`
        );

        const influencerConfig = influencerConfigs[0] ? {
            enabled: influencerConfigs[0].enabled,
            detection_source: influencerConfigs[0].detection_source,
            check_interval_minutes: influencerConfigs[0].check_interval_minutes,
            max_posts_per_check: influencerConfigs[0].max_posts_per_check,
            target_forums: (() => { const v = influencerConfigs[0].target_forums; if (!v) return []; if (Array.isArray(v)) return v; try { return JSON.parse(v); } catch { return []; } })(),
            min_likes: influencerConfigs[0].min_likes,
            keyword_filters: (() => { const v = influencerConfigs[0].keyword_filters; if (!v) return []; if (Array.isArray(v)) return v; try { return JSON.parse(v); } catch { return []; } })(),
            exclude_keywords: (() => { const v = influencerConfigs[0].exclude_keywords; if (!v) return []; if (Array.isArray(v)) return v; try { return JSON.parse(v); } catch { return []; } })(),
            twitter_patterns: (() => { const v = influencerConfigs[0].twitter_patterns; if (!v) return []; if (Array.isArray(v)) return v; try { return JSON.parse(v); } catch { return []; } })(),
            notify_on_new: influencerConfigs[0].notify_on_new,
            last_check_at: influencerConfigs[0].last_check_at,
        } : null;

        // 5. 彙整所有關鍵字的扁平列表（方便 Agent 快速取用）
        const allKeywords = new Set<string>();
        const allExcludeKeywords = new Set<string>();
        parsedBrands.forEach((b: any) => {
            (b.keywords || []).forEach((k: string) => allKeywords.add(k));
            (b.exclude_keywords || []).forEach((k: string) => allExcludeKeywords.add(k));
        });

        res.json({
            success: true,
            data: {
                brands: parsedBrands,
                sources: sources,
                brand_source_mappings: parsedBrandSources,
                influencer_detection: influencerConfig,
                summary: {
                    total_brands: parsedBrands.length,
                    total_sources: sources.length,
                    all_keywords: Array.from(allKeywords),
                    all_exclude_keywords: Array.from(allExcludeKeywords),
                },
            },
        });
    } catch (error) {
        logger.error('[Agent] 取得監控關鍵字失敗:', error);
        res.status(500).json({ success: false, error: 'Failed to get monitor keywords' });
    }
}

/**
 * POST /api/agent/dcard/authors
 * 接收偵測到的網紅作者
 * 重複資料依 dcard_id 判斷，已存在則更新資料並累加 detection_count
 */
export async function receiveAuthors(req: Request, res: Response): Promise<void> {
    try {
        const { authors } = req.body;

        if (!Array.isArray(authors) || authors.length === 0) {
            res.status(400).json({ success: false, error: 'authors must be a non-empty array' });
            return;
        }

        const pool = getPool();
        let newAuthors = 0;
        let updated = 0;
        const errors: string[] = [];

        for (let i = 0; i < authors.length; i++) {
            const author = authors[i];
            try {
                const {
                    dcard_id, dcard_username, name, dcard_bio, dcard_url,
                    twitter_id, twitter_display_name, twitter_url,
                    last_dcard_post_at, last_twitter_post_at, source_forum,
                } = author;

                // 支援 name 作為 dcard_username 的別名
                const username = dcard_username || name || null;

                if (!dcard_id) {
                    errors.push(`[${i}] 缺少 dcard_id，已跳過`);
                    continue;
                }

                // 檢查作者是否已存在
                const [existing] = await pool.execute<RowDataPacket[]>(
                    `SELECT id FROM influencer_authors WHERE dcard_id = ? LIMIT 1`,
                    [dcard_id]
                );

                if (existing.length > 0) {
                    // 更新現有作者（COALESCE 保留原有非 null 值）
                    await pool.execute(
                        `UPDATE influencer_authors SET
                            dcard_username = COALESCE(?, dcard_username),
                            dcard_bio = COALESCE(?, dcard_bio),
                            dcard_url = COALESCE(?, dcard_url),
                            twitter_id = COALESCE(?, twitter_id),
                            twitter_display_name = COALESCE(?, twitter_display_name),
                            twitter_url = COALESCE(?, twitter_url),
                            last_dcard_post_at = COALESCE(?, last_dcard_post_at),
                            last_twitter_post_at = COALESCE(?, last_twitter_post_at),
                            last_seen_at = NOW(),
                            detection_count = detection_count + 1,
                            updated_at = NOW()
                        WHERE id = ?`,
                        [
                            username, dcard_bio, dcard_url,
                            twitter_id, twitter_display_name, twitter_url,
                            last_dcard_post_at ? new Date(last_dcard_post_at) : null,
                            last_twitter_post_at ? new Date(last_twitter_post_at) : null,
                            existing[0].id,
                        ]
                    );
                    updated++;
                } else {
                    // 新增作者
                    await pool.execute(
                        `INSERT INTO influencer_authors (
                            id, dcard_id, dcard_username, dcard_bio, dcard_url,
                            twitter_id, twitter_display_name, twitter_url,
                            last_dcard_post_at, last_twitter_post_at,
                            source_forum, status, first_detected_at, last_seen_at,
                            created_at, updated_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', NOW(), NOW(), NOW(), NOW())`,
                        [
                            generateUUID(), dcard_id, username, dcard_bio, dcard_url,
                            twitter_id, twitter_display_name, twitter_url,
                            last_dcard_post_at ? new Date(last_dcard_post_at) : null,
                            last_twitter_post_at ? new Date(last_twitter_post_at) : null,
                            source_forum,
                        ]
                    );
                    newAuthors++;
                }
            } catch (err: any) {
                const errMsg = `[${i}] dcard_id=${author.dcard_id || '?'} 儲存失敗: ${err.message}`;
                logger.error('[Agent] ' + errMsg);
                errors.push(errMsg);
            }
        }

        logger.info(`[Agent] 接收 authors: ${newAuthors} 新增, ${updated} 更新, ${errors.length} 失敗`);
        res.json({
            success: true,
            data: { newAuthors, updated, total: authors.length, failed: errors.length },
            ...(errors.length > 0 ? { errors } : {}),
        });
    } catch (error) {
        logger.error('[Agent] 接收 authors 失敗:', error);
        res.status(500).json({ success: false, error: 'Failed to receive authors' });
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
