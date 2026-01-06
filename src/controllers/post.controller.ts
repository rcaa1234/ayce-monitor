import { Response } from 'express';
import { AuthRequest } from '../middlewares/auth.middleware';
import { PostModel } from '../models/post.model';
import queueService from '../services/queue.service';
import { AuditModel } from '../models/audit.model';
import { PostStatus, EngineType } from '../types';
import logger from '../utils/logger';

export class PostController {
  /**
   * Create a new post and trigger generation
   */
  async create(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { stylePreset, topic, keywords } = req.body;
      const userId = req.user!.id;

      // Create post
      const post = await PostModel.create({
        created_by: userId,
        status: PostStatus.DRAFT,
      });

      // Add to generation queue
      await queueService.addGenerateJob({
        postId: post.id,
        stylePreset,
        topic,
        keywords,
        createdBy: userId,
      });

      // Log audit
      await AuditModel.log({
        actor_user_id: userId,
        action: 'post_created',
        target_type: 'post',
        target_id: post.id,
        metadata: { stylePreset, topic, keywords },
      });

      res.status(201).json({
        success: true,
        post: {
          id: post.id,
          status: post.status,
        },
      });
    } catch (error: any) {
      logger.error('Failed to create post:', error);
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Get post by ID
   */
  async getById(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const post = await PostModel.findById(id);

      if (!post) {
        res.status(404).json({ error: 'Post not found' });
        return;
      }

      // Get revisions
      const revisions = await PostModel.getRevisions(id);

      res.json({
        success: true,
        post,
        revisions,
      });
    } catch (error: any) {
      logger.error('Failed to get post:', error);
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Get posts by status
   */
  async getByStatus(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { status, limit } = req.query;
      const pool = (await import('../database/connection')).getPool();

      // If no status provided, get all posts
      let posts;
      let total = 0;

      if (status && status !== 'ALL') {
        posts = await PostModel.findByStatus(
          status as PostStatus,
          limit ? parseInt(limit as string) : undefined
        );
        // Get total count for this status
        const [countRows] = await pool.execute(
          'SELECT COUNT(*) as count FROM posts WHERE status = ?',
          [status]
        );
        total = (countRows as any)[0]?.count || 0;
      } else {
        // Get all posts when status is not specified or is 'ALL'
        const limitVal = limit ? parseInt(limit as string) : 100;

        // Get total count of all posts
        const [countRows] = await pool.execute('SELECT COUNT(*) as count FROM posts');
        total = (countRows as any)[0]?.count || 0;

        const query = `SELECT * FROM posts ORDER BY created_at DESC LIMIT ${limitVal}`;
        const [rows] = await pool.execute(query);
        posts = rows;
      }

      res.json({
        success: true,
        data: posts,
        total: total,
      });
    } catch (error: any) {
      logger.error('Failed to get posts:', error);
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Manually approve a post
   */
  async approve(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const userId = req.user!.id;

      const post = await PostModel.findById(id);

      if (!post) {
        res.status(404).json({ error: 'Post not found' });
        return;
      }

      if (post.status !== PostStatus.PENDING_REVIEW) {
        res.status(400).json({ error: 'Post is not pending review' });
        return;
      }

      // Get latest revision
      const revision = await PostModel.getLatestRevision(id);

      if (!revision) {
        res.status(400).json({ error: 'No revision found' });
        return;
      }

      // Update status to approved
      await PostModel.updateStatus(id, PostStatus.APPROVED, {
        approved_by: userId,
        approved_at: new Date(),
      });

      // Add to publish queue
      await queueService.addPublishJob({
        postId: id,
        revisionId: revision.id,
      });

      // Log audit
      await AuditModel.log({
        actor_user_id: userId,
        action: 'post_approved',
        target_type: 'post',
        target_id: id,
        metadata: { revision_id: revision.id },
      });

      res.json({
        success: true,
        message: 'Post approved and queued for publishing',
      });
    } catch (error: any) {
      logger.error('Failed to approve post:', error);
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Skip a post
   */
  async skip(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const userId = req.user!.id;

      await PostModel.updateStatus(id, PostStatus.SKIPPED);

      // Log audit
      await AuditModel.log({
        actor_user_id: userId,
        action: 'post_skipped',
        target_type: 'post',
        target_id: id,
      });

      res.json({
        success: true,
        message: 'Post skipped',
      });
    } catch (error: any) {
      logger.error('Failed to skip post:', error);
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Create manual post without AI generation
   */
  async createManual(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { content, accountId, scheduledFor } = req.body;
      const userId = req.user!.id;

      if (!content || !content.trim()) {
        res.status(400).json({ error: '貼文內容不能為空' });
        return;
      }

      if (content.length > 500) {
        res.status(400).json({ error: '貼文內容不能超過 500 字' });
        return;
      }

      if (!accountId) {
        res.status(400).json({ error: '請選擇 Threads 帳號' });
        return;
      }

      // Create post with manual content
      const post = await PostModel.create({
        created_by: userId,
        status: PostStatus.DRAFT,
        threads_account_id: accountId,
        scheduled_for: scheduledFor ? new Date(scheduledFor) : null,
      });

      // Create revision with manual content (engine_used = MANUAL)
      const revision = await PostModel.createRevision({
        post_id: post.id,
        content: content.trim(),
        engine_used: EngineType.MANUAL,
        similarity_max: 0,
      });

      // Update post to approved status (skip review for manual posts)
      await PostModel.updateStatus(post.id, PostStatus.APPROVED, {
        approved_by: userId,
        approved_at: new Date(),
      });

      // Add to publish queue
      await queueService.addPublishJob({
        postId: post.id,
        revisionId: revision.id,
        accountId,
        scheduledFor: scheduledFor ? new Date(scheduledFor) : undefined,
      });

      // Log audit
      await AuditModel.log({
        actor_user_id: userId,
        action: 'manual_post_created',
        target_type: 'post',
        target_id: post.id,
        metadata: {
          accountId,
          scheduledFor,
          contentLength: content.length
        },
      });

      res.status(201).json({
        success: true,
        post: {
          id: post.id,
          status: PostStatus.APPROVED,
        },
        message: scheduledFor ? '貼文已排程成功' : '貼文已加入發布佇列',
      });
    } catch (error: any) {
      logger.error('Failed to create manual post:', error);
      res.status(500).json({ error: error.message });
    }
  }
}

export default new PostController();
