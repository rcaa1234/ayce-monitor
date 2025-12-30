import { Router, Request, Response } from 'express';
import postController from '../controllers/post.controller';
import reviewController from '../controllers/review.controller';
import { authenticate, AuthRequest } from '../middlewares/auth.middleware';
import { UserModel } from '../models/user.model';
import jwt from 'jsonwebtoken';
import config from '../config';
import logger from '../utils/logger';

const router = Router();

// Health check
router.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Auth routes
router.post('/auth/login', async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required' });
      return;
    }

    const user = await UserModel.findByEmail(email);
    if (!user) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const isValid = await UserModel.verifyPassword(password, user.password_hash);
    if (!isValid) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    if (user.status !== 'ACTIVE') {
      res.status(403).json({ error: 'Account is disabled' });
      return;
    }

    // Get user roles
    const roles = await UserModel.getRoles(user.id);

    // Generate JWT token
    const token = jwt.sign(
      {
        userId: user.id,
        email: user.email,
        roles: roles,
      },
      config.jwt.secret,
      { expiresIn: '7d' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        roles: roles,
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Login failed', message: error.message });
  }
});

// Post routes (require authentication)
router.post('/posts', authenticate, postController.create.bind(postController));
router.post('/posts/manual', authenticate, postController.createManual.bind(postController));
router.get('/posts', authenticate, postController.getByStatus.bind(postController));
router.get('/posts/:id', authenticate, postController.getById.bind(postController));

router.patch('/posts/:id', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const { PostModel } = await import('../models/post.model');
    const post = await PostModel.findById(id);

    if (!post) {
      res.status(404).json({ error: 'Post not found' });
      return;
    }

    // Update post fields
    await PostModel.update(id, updates);

    const updatedPost = await PostModel.findById(id);
    res.json(updatedPost);
  } catch (error: any) {
    res.status(500).json({ error: 'Update failed', message: error.message });
  }
});

router.delete('/posts/:id', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const { PostModel } = await import('../models/post.model');
    const post = await PostModel.findById(id);

    if (!post) {
      res.status(404).json({ error: 'Post not found' });
      return;
    }

    await PostModel.delete(id);
    res.json({ message: 'Post deleted successfully' });
  } catch (error: any) {
    res.status(500).json({ error: 'Delete failed', message: error.message });
  }
});

router.post('/posts/:id/generate', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const userId = (req as AuthRequest).user!.id;

    const { PostModel } = await import('../models/post.model');
    const post = await PostModel.findById(id);

    if (!post) {
      res.status(404).json({ error: 'Post not found' });
      return;
    }

    // Add to generation queue
    const queueService = (await import('../services/queue.service')).default;
    const job = await queueService.addGenerateJob({
      postId: id,
      createdBy: userId,
    });

    res.json({
      message: 'Content generation queued',
      jobId: job.id,
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to queue generation', message: error.message });
  }
});

router.post('/posts/:id/publish', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const { PostModel } = await import('../models/post.model');
    const post = await PostModel.findById(id);

    if (!post) {
      res.status(404).json({ error: 'Post not found' });
      return;
    }

    if (post.status !== 'APPROVED') {
      res.status(400).json({ error: 'Post must be approved before publishing' });
      return;
    }

    // Get latest revision
    const revision = await PostModel.getLatestRevision(id);
    if (!revision) {
      res.status(400).json({ error: 'No content revision found' });
      return;
    }

    // Add to publish queue
    const queueService = (await import('../services/queue.service')).default;
    const job = await queueService.addPublishJob({
      postId: id,
      revisionId: revision.id,
    });

    res.json({
      message: 'Publish queued',
      jobId: job.id,
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to queue publish', message: error.message });
  }
});

// Review routes
router.post('/review/approve', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const { postId, revisionId, action } = req.body;

    if (!postId || !revisionId || !action) {
      res.status(400).json({ error: 'Missing required fields' });
      return;
    }

    const { PostModel } = await import('../models/post.model');
    const { PostStatus } = await import('../types');

    if (action === 'approve') {
      await PostModel.updateStatus(postId, PostStatus.APPROVED, {
        approved_by: (req as AuthRequest).user!.id,
        approved_at: new Date(),
      });

      res.json({ message: 'Post approved' });
    } else if (action === 'regenerate') {
      await PostModel.updateStatus(postId, PostStatus.DRAFT);

      // Trigger regeneration
      const queueService = (await import('../services/queue.service')).default;
      await queueService.addGenerateJob({
        postId: postId,
        createdBy: (req as AuthRequest).user!.id,
      });

      res.json({ message: 'Regeneration queued' });
    } else if (action === 'skip') {
      await PostModel.updateStatus(postId, PostStatus.SKIPPED);
      res.json({ message: 'Post skipped' });
    } else {
      res.status(400).json({ error: 'Invalid action' });
    }
  } catch (error: any) {
    res.status(500).json({ error: 'Review action failed', message: error.message });
  }
});

// Threads OAuth Flow
router.get('/threads/oauth/authorize', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { threads } = config;

    if (!threads.clientId || !threads.clientSecret) {
      res.status(500).json({ error: 'Threads OAuth not configured. Please set THREADS_CLIENT_ID and THREADS_CLIENT_SECRET in .env.local' });
      return;
    }

    const authUrl = new URL('https://threads.net/oauth/authorize');
    authUrl.searchParams.append('client_id', threads.clientId);
    authUrl.searchParams.append('redirect_uri', threads.redirectUri);
    authUrl.searchParams.append('scope', 'threads_basic,threads_content_publish');
    authUrl.searchParams.append('response_type', 'code');
    authUrl.searchParams.append('state', req.user!.id); // Store user ID in state

    // Return the auth URL instead of redirecting
    res.json({ authUrl: authUrl.toString() });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to start OAuth', message: error.message });
  }
});

router.get('/threads/oauth/callback', async (req: Request, res: Response): Promise<void> => {
  try {
    const { code, state } = req.query;

    if (!code || !state) {
      res.status(400).send('Missing code or state parameter');
      return;
    }

    const userId = state as string;
    const { threads } = config;

    // Exchange code for access token
    const axios = (await import('axios')).default;
    const qs = require('querystring');

    logger.info(`Exchanging code for access token, redirect_uri: ${threads.redirectUri}`);

    const tokenParams = qs.stringify({
      client_id: threads.clientId,
      client_secret: threads.clientSecret,
      grant_type: 'authorization_code',
      redirect_uri: threads.redirectUri,
      code: code,
    });

    const tokenResponse = await axios.post('https://graph.threads.net/oauth/access_token', tokenParams, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    logger.info(`Short-lived token response received`);

    const { access_token: shortLivedToken, user_id } = tokenResponse.data;

    // Exchange short-lived token for long-lived token (60 days)
    logger.info(`Exchanging short-lived token for long-lived token`);
    const longLivedTokenResponse = await axios.get('https://graph.threads.net/access_token', {
      params: {
        grant_type: 'th_exchange_token',
        client_secret: threads.clientSecret,
        access_token: shortLivedToken,
      }
    });

    logger.info(`Long-lived token received, expires in: ${longLivedTokenResponse.data.expires_in} seconds`);
    const { access_token, expires_in } = longLivedTokenResponse.data;

    // Get user profile - use 'me' endpoint or direct user_id with proper format
    logger.info(`Fetching user profile for user_id: ${user_id}`);

    // Try using 'me' endpoint first, which is more reliable
    const profileResponse = await axios.get(`https://graph.threads.net/v1.0/me`, {
      params: {
        fields: 'id,username,threads_profile_picture_url,threads_biography',
        access_token: access_token,
      },
    });

    logger.info(`Profile response received: ${JSON.stringify(profileResponse.data)}`);

    const { username, id: threadsUserId } = profileResponse.data;

    // Use the id from profile response as the actual Threads user ID
    const actualUserId = threadsUserId || user_id;

    // Save to database
    const { getPool } = await import('../database/connection');
    const { generateUUID } = await import('../utils/uuid');
    const { encrypt } = await import('../utils/encryption');

    const pool = getPool();
    const accountId = generateUUID();
    const authId = generateUUID();

    // Insert account
    logger.info(`Inserting account: accountId=${accountId}, userId=${userId}, username=${username}, threadsUserId=${actualUserId}`);

    await pool.execute(
      'INSERT INTO threads_accounts (id, user_id, username, account_id) VALUES (?, ?, ?, ?)',
      [accountId, userId, username, actualUserId]
    );

    // Encrypt and store token
    const encryptedToken = encrypt(access_token);
    const expiresAt = new Date(Date.now() + (expires_in * 1000)); // Convert seconds to milliseconds

    await pool.execute(
      `INSERT INTO threads_auth (id, account_id, access_token, token_type, expires_at)
       VALUES (?, ?, ?, 'Bearer', ?)`,
      [authId, accountId, encryptedToken, expiresAt]
    );

    // Redirect back to frontend
    res.send(`
      <html>
        <head>
          <title>授權成功</title>
          <style>
            body { font-family: sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); }
            .card { background: white; padding: 40px; border-radius: 15px; text-align: center; box-shadow: 0 10px 40px rgba(0,0,0,0.2); }
            h1 { color: #333; margin-bottom: 20px; }
            p { color: #666; margin-bottom: 30px; }
            a { display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 12px 30px; border-radius: 8px; text-decoration: none; }
          </style>
        </head>
        <body>
          <div class="card">
            <h1>✅ Threads 帳號連結成功!</h1>
            <p>帳號 @${username} 已成功連結</p>
            <a href="/">返回管理介面</a>
          </div>
          <script>
            setTimeout(() => { window.location.href = '/#accounts'; window.location.reload(); }, 2000);
          </script>
        </body>
      </html>
    `);
  } catch (error: any) {
    logger.error('OAuth callback error:', error);
    logger.error('Error details:', {
      message: error.message,
      response: error.response?.data,
      status: error.response?.status,
      stack: error.stack
    });

    const errorDetail = error.response?.data ? JSON.stringify(error.response.data) : error.message;

    res.status(500).send(`
      <html>
        <body style="font-family: sans-serif; padding: 40px;">
          <h1>❌ 授權失敗</h1>
          <p>錯誤: ${error.message}</p>
          <p style="font-size: 12px; color: #666;">詳細資訊: ${errorDetail}</p>
          <a href="/">返回管理介面</a>
        </body>
      </html>
    `);
  }
});

// Threads Accounts Management
router.get('/threads/accounts', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const { getPool } = await import('../database/connection');
    const pool = getPool();

    const [accounts] = await pool.execute<any>(
      `SELECT ta.id, ta.username, ta.account_id as threads_user_id, ta.created_at
       FROM threads_accounts ta
       WHERE ta.user_id = ?
       ORDER BY ta.created_at DESC`,
      [(req as AuthRequest).user!.id]
    );

    res.json({ accounts });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to load accounts', message: error.message });
  }
});

router.delete('/threads/accounts/:id', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { getPool } = await import('../database/connection');
    const pool = getPool();

    // Delete account and associated auth
    await pool.execute(
      'DELETE FROM threads_accounts WHERE id = ? AND user_id = ?',
      [id, (req as AuthRequest).user!.id]
    );

    res.json({ message: 'Account removed successfully' });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to remove account', message: error.message });
  }
});

// System Settings routes
router.get('/settings', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const { SettingsModel } = await import('../models/settings.model');
    const settings = await SettingsModel.getAll();
    res.json({ success: true, settings });
  } catch (error: any) {
    logger.error('Failed to get settings:', error);
    res.status(500).json({ error: 'Failed to load settings', message: error.message });
  }
});

router.put('/settings', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const { SettingsModel } = await import('../models/settings.model');
    const { settings } = req.body;

    if (!settings || typeof settings !== 'object') {
      res.status(400).json({ error: 'Invalid settings data' });
      return;
    }

    await SettingsModel.updateMultiple(settings);

    // If schedule_config was updated, reload the scheduler
    if (settings.schedule_config) {
      logger.info('排程設定已更新，正在重新載入排程器...');
      const { initializeDynamicSchedule } = await import('../cron/scheduler');
      await initializeDynamicSchedule();
      logger.info('排程器已成功重新載入');
    }

    res.json({ success: true, message: 'Settings updated successfully' });
  } catch (error: any) {
    logger.error('Failed to update settings:', error);
    res.status(500).json({ error: 'Failed to update settings', message: error.message });
  }
});

router.post('/settings/test-generate', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const { SettingsModel } = await import('../models/settings.model');
    const contentService = (await import('../services/content.service')).default;
    const lineService = (await import('../services/line.service')).default;
    const { PostModel } = await import('../models/post.model');
    const { PostStatus, EngineType } = await import('../types');
    const { generateUUID } = await import('../utils/uuid');
    const { getPool } = await import('../database/connection');

    // Get settings
    const aiEngine = await SettingsModel.get('ai_engine');
    const customPrompt = await SettingsModel.get('custom_prompt');
    const lineNotifyUserId = await SettingsModel.get('line_notify_user_id');

    logger.info(`Settings loaded - aiEngine: ${JSON.stringify(aiEngine)}, customPrompt type: ${typeof customPrompt}`);

    if (!lineNotifyUserId) {
      res.status(400).json({ error: '請先設定 LINE User ID 才能進行完整測試' });
      return;
    }

    // Extract engine string from aiEngine (it might be an object or string)
    const engineString = typeof aiEngine === 'string'
      ? aiEngine
      : (aiEngine && typeof aiEngine === 'object' ? aiEngine.value : undefined);

    // Convert string to EngineType enum properly
    const engineType = (engineString && typeof engineString === 'string' && engineString in EngineType)
      ? engineString as EngineType
      : EngineType.GPT4O;

    // Extract prompt string from customPrompt (it might be an object or string)
    const promptString = typeof customPrompt === 'string'
      ? customPrompt
      : (customPrompt && typeof customPrompt === 'object' ? customPrompt.value : undefined);

    logger.info(`Starting end-to-end test - Engine string: ${engineString}, Engine type: ${engineType}, Prompt: ${promptString ? 'set' : 'not set'}`);

    // Step 1: Create test post in database
    const post = await PostModel.create({
      created_by: (req as AuthRequest).user!.id,
      status: PostStatus.DRAFT,
    });

    logger.info(`Created test post: ${post.id}`);

    try {
      // Step 2: Generate content with similarity check
      const result = await contentService.generateContent(post.id, {
        engine: engineType,
        systemPrompt: promptString || undefined,
        topic: '測試生成 - 完整流程',
      });

      logger.info(`Generated content for post ${post.id}, similarity: ${result.similarityMax}`);

      // Step 3: Create review token
      const pool = getPool();
      const reviewToken = generateUUID();
      const reviewRequestId = generateUUID();
      const currentUserId = (req as AuthRequest).user!.id;

      // First check if user exists with this line_user_id
      const [userRows] = await pool.execute(
        'SELECT id FROM users WHERE line_user_id = ? LIMIT 1',
        [lineNotifyUserId]
      );

      let reviewerUserId = currentUserId;
      if (userRows.length > 0) {
        reviewerUserId = userRows[0].id;
        logger.info(`Found user with LINE ID ${lineNotifyUserId}: ${reviewerUserId}`);
      } else {
        logger.warn(`No user found with LINE ID ${lineNotifyUserId}, using current user: ${currentUserId}`);
      }

      // Create review request
      await pool.execute(
        `INSERT INTO review_requests (id, post_id, revision_id, reviewer_user_id, status, token, expires_at)
         VALUES (?, ?, ?, ?, 'PENDING', ?, DATE_ADD(NOW(), INTERVAL 7 DAY))`,
        [reviewRequestId, post.id, result.revisionId, reviewerUserId, reviewToken]
      );

      logger.info(`Created review request ${reviewRequestId} for post ${post.id} with token ${reviewToken}`);

      // Step 4: Send LINE notification with interactive buttons
      await lineService.sendFlexMessage(lineNotifyUserId, {
        type: 'bubble',
        hero: {
          type: 'box',
          layout: 'vertical',
          contents: [
            {
              type: 'text',
              text: '🧪 測試文章已生成',
              weight: 'bold',
              size: 'xl',
              color: '#1DB446',
            },
          ],
          paddingAll: 'lg',
        },
        body: {
          type: 'box',
          layout: 'vertical',
          contents: [
            {
              type: 'text',
              text: '📊 生成資訊',
              weight: 'bold',
              size: 'md',
              margin: 'none',
            },
            {
              type: 'text',
              text: `🤖 引擎: ${engineType}`,
              size: 'sm',
              color: '#666666',
              margin: 'md',
            },
            {
              type: 'text',
              text: `📈 相似度: ${(result.similarityMax * 100).toFixed(1)}%`,
              size: 'sm',
              color: result.similarityMax > 0.86 ? '#FF0000' : '#666666',
              margin: 'xs',
            },
            {
              type: 'separator',
              margin: 'lg',
            },
            {
              type: 'text',
              text: '📝 文章內容',
              weight: 'bold',
              size: 'md',
              margin: 'lg',
            },
            {
              type: 'text',
              text: result.content.substring(0, 300) + (result.content.length > 300 ? '...' : ''),
              wrap: true,
              color: '#333333',
              margin: 'md',
              size: 'sm',
            },
          ],
        },
        footer: {
          type: 'box',
          layout: 'vertical',
          spacing: 'sm',
          contents: [
            {
              type: 'button',
              style: 'primary',
              height: 'sm',
              action: {
                type: 'uri',
                label: '✅ 確認發文到 Threads',
                uri: `${config.app.baseUrl}/api/review/test-approve?token=${reviewToken}&lineUserId=${lineNotifyUserId}`,
              },
            },
            {
              type: 'button',
              style: 'secondary',
              height: 'sm',
              action: {
                type: 'uri',
                label: '🔄 重新生成',
                uri: `${config.app.baseUrl}/api/review/test-regenerate?postId=${post.id}&lineUserId=${lineNotifyUserId}`,
              },
            },
            {
              type: 'button',
              style: 'link',
              height: 'sm',
              action: {
                type: 'message',
                label: '✏️ 修改內容',
                text: '請直接輸入修改後的文章內容',
              },
            },
          ],
        },
      });

      logger.info(`Sent interactive review notification to LINE user ${lineNotifyUserId}`);

      res.json({
        success: true,
        message: '測試文章已生成並發送到 LINE，請在 LINE 中進行審核',
        postId: post.id,
        content: result.content,
        similarity: result.similarityMax,
        engine: engineType,
      });
    } catch (error: any) {
      // If generation failed, update post status
      logger.error('Content generation error:', error);
      await PostModel.updateStatus(post.id, PostStatus.FAILED, {
        last_error_message: error.message,
      });
      throw error;
    }
  } catch (error: any) {
    logger.error('測試文章生成失敗:', error);
    logger.error('錯誤堆疊:', error.stack);
    res.status(500).json({
      error: '測試文章生成失敗',
      message: error.message || '未知錯誤',
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Test LINE notification
router.post('/settings/test-line', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const { SettingsModel } = await import('../models/settings.model');
    const lineService = (await import('../services/line.service')).default;

    const lineNotifyUserId = await SettingsModel.get('line_notify_user_id');

    if (!lineNotifyUserId) {
      res.status(400).json({ error: 'LINE User ID not configured' });
      return;
    }

    await lineService.sendNotification(
      lineNotifyUserId,
      `🔔 LINE 通知測試\n\n這是一則測試訊息，確認您的 LINE Bot 通知設定正常運作！\n\n✅ 如果您收到此訊息，表示設定成功！`
    );

    logger.info(`Sent test notification to LINE user ${lineNotifyUserId}`);
    res.json({ success: true, message: 'Test notification sent to LINE' });
  } catch (error: any) {
    logger.error('Failed to send LINE test notification:', error);
    res.status(500).json({ error: 'Failed to send LINE notification', message: error.message });
  }
});

// LINE webhook
router.post('/webhook/line', async (req: Request, res: Response): Promise<void> => {
  try {
    const lineService = (await import('../services/line.service')).default;
    const { getPool } = await import('../database/connection');
    const events = req.body.events;

    for (const event of events) {
      // Handle text messages (for editing content)
      if (event.type === 'message' && event.message.type === 'text') {
        const lineUserId = event.source.userId;
        const editedText = event.message.text;

        // Handle special commands
        if (editedText.toLowerCase() === '/myid' || editedText === '我的ID' || editedText === '查詢ID') {
          await lineService.sendNotification(
            lineUserId,
            `📱 您的 LINE User ID:\n${lineUserId}\n\n請複製此 ID 並貼到網站的「自動化發文設定」→「LINE 通知設定」中，系統才能將審核通知發送給您。`
          );
          continue;
        }

        // Find pending review for this user
        const pool = getPool();
        const [rows] = await pool.execute(
          `SELECT rr.*, pr.content as original_content
           FROM review_requests rr
           JOIN post_revisions pr ON rr.revision_id = pr.id
           WHERE rr.reviewer_user_id IN (
             SELECT id FROM users WHERE line_user_id = ?
           )
           AND rr.status = 'PENDING'
           ORDER BY rr.created_at DESC
           LIMIT 1`,
          [lineUserId]
        );

        if (rows.length > 0) {
          const reviewRequest = rows[0];

          // Update with edited content
          await pool.execute(
            'UPDATE review_requests SET edited_content = ? WHERE id = ?',
            [editedText, reviewRequest.id]
          );

          // Send confirmation with buttons
          await lineService.sendFlexMessage(lineUserId, {
            type: 'bubble',
            body: {
              type: 'box',
              layout: 'vertical',
              contents: [
                {
                  type: 'text',
                  text: '✅ 已收到修改內容',
                  weight: 'bold',
                  size: 'xl',
                },
                {
                  type: 'text',
                  text: '請選擇操作：',
                  margin: 'md',
                  color: '#666666',
                },
                {
                  type: 'separator',
                  margin: 'lg',
                },
                {
                  type: 'text',
                  text: editedText,
                  wrap: true,
                  margin: 'lg',
                  color: '#333333',
                },
              ],
            },
            footer: {
              type: 'box',
              layout: 'vertical',
              spacing: 'sm',
              contents: [
                {
                  type: 'button',
                  style: 'primary',
                  action: {
                    type: 'uri',
                    label: '✅ 確認發布',
                    uri: `${config.server.baseUrl}/api/review/approve-edited?token=${reviewRequest.token}&lineUserId=${lineUserId}`,
                  },
                },
                {
                  type: 'button',
                  action: {
                    type: 'uri',
                    label: '↻ 重新輸入',
                    uri: `line://nv/chat`,
                  },
                },
              ],
            },
          });
        } else {
          await lineService.sendNotification(
            lineUserId,
            '找不到待審核的貼文。請確認是否有收到審核通知。'
          );
        }
      }
    }

    res.json({ status: 'ok' });
  } catch (error: any) {
    logger.error('LINE webhook error:', error);
    res.status(500).json({ error: error.message });
  }
});

// LINE Review Actions
router.get('/review/approve', reviewController.approve.bind(reviewController));

router.get('/review/approve-edited', async (req: Request, res: Response): Promise<void> => {
  try {
    const { token, lineUserId } = req.query;

    if (!token || !lineUserId) {
      res.status(400).send('缺少參數');
      return;
    }

    const lineService = (await import('../services/line.service')).default;
    const queueService = (await import('../services/queue.service')).default;
    const { PostModel } = await import('../models/post.model');
    const { PostStatus } = await import('../types');
    const { getPool } = await import('../database/connection');
    const { generateUUID } = await import('../utils/uuid');

    // Validate token
    const reviewRequest = await lineService.validateReviewToken(
      token as string,
      lineUserId as string
    );

    if (!reviewRequest) {
      res.status(400).send('無效或已過期的審核連結');
      return;
    }

    // Get edited content
    const pool = getPool();
    const [rows] = await pool.execute(
      'SELECT edited_content FROM review_requests WHERE id = ?',
      [reviewRequest.id]
    );

    if (rows.length === 0 || !rows[0].edited_content) {
      res.status(400).send('找不到編輯後的內容');
      return;
    }

    const editedContent = rows[0].edited_content;

    // Create new revision with edited content
    const newRevisionId = generateUUID();
    const [originalRevision] = await pool.execute(
      'SELECT revision_no FROM post_revisions WHERE id = ?',
      [reviewRequest.revision_id]
    );

    const newRevisionNo = originalRevision[0].revision_no + 1;

    await pool.execute(
      `INSERT INTO post_revisions (id, post_id, revision_no, content, engine_used, similarity_max, created_at)
       VALUES (?, ?, ?, ?, 'MANUAL_EDIT', 0, NOW())`,
      [newRevisionId, reviewRequest.post_id, newRevisionNo, editedContent]
    );

    // Mark review as used
    await lineService.markReviewUsed(reviewRequest.id);

    // Update post status to APPROVED
    await PostModel.updateStatus(reviewRequest.post_id, PostStatus.APPROVED, {
      approved_by: reviewRequest.reviewer_user_id,
      approved_at: new Date(),
    });

    // Add to publish queue with new revision
    await queueService.addPublishJob({
      postId: reviewRequest.post_id,
      revisionId: newRevisionId,
    });

    // Send confirmation
    await lineService.sendNotification(
      lineUserId as string,
      '✅ 已使用您修改的內容，貼文將很快發布！'
    );

    res.send(`
      <html>
        <body style="font-family: Arial; text-align: center; padding: 50px;">
          <h1>✅ 已核准（使用修改內容）</h1>
          <p>貼文將使用您修改後的內容發布</p>
          <p>您可以關閉此頁面</p>
        </body>
      </html>
    `);
  } catch (error: any) {
    logger.error('Failed to approve edited content:', error);
    res.status(500).send('處理失敗: ' + error.message);
  }
});

router.get('/review/regenerate', reviewController.regenerate.bind(reviewController));
router.get('/review/skip', reviewController.skip.bind(reviewController));

// Test-specific review actions
router.get('/review/test-approve', async (req: Request, res: Response): Promise<void> => {
  try {
    const { token, lineUserId } = req.query;

    if (!token || !lineUserId) {
      res.status(400).send('缺少參數');
      return;
    }

    const lineService = (await import('../services/line.service')).default;
    const queueService = (await import('../services/queue.service')).default;
    const { PostModel } = await import('../models/post.model');
    const { PostStatus } = await import('../types');
    const { getPool } = await import('../database/connection');

    // Validate token
    const pool = getPool();

    logger.info(`Test approve - token: ${token}, lineUserId: ${lineUserId}`);

    const [rows] = await pool.execute(
      `SELECT rr.*, u.line_user_id
       FROM review_requests rr
       JOIN users u ON rr.reviewer_user_id = u.id
       WHERE rr.token = ? AND u.line_user_id = ? AND rr.status = 'PENDING'`,
      [token, lineUserId]
    );

    logger.info(`Found ${rows.length} matching review requests`);

    if (rows.length === 0) {
      // Try to find the review request to see what's wrong
      const [allReviews] = await pool.execute(
        `SELECT rr.id, rr.token, rr.status, u.line_user_id
         FROM review_requests rr
         JOIN users u ON rr.reviewer_user_id = u.id
         WHERE rr.token = ?
         LIMIT 1`,
        [token]
      );

      logger.error(`Review request not found. Searched token exists: ${allReviews.length > 0}`);
      if (allReviews.length > 0) {
        logger.error(`Found review: status=${allReviews[0].status}, line_user_id=${allReviews[0].line_user_id}, provided=${lineUserId}`);
      }

      res.status(400).send('無效或已過期的審核連結');
      return;
    }

    const reviewRequest = rows[0];

    // Update review status
    await pool.execute(
      'UPDATE review_requests SET status = \'APPROVED\', reviewed_at = NOW() WHERE id = ?',
      [reviewRequest.id]
    );

    // Update post status to PUBLISHING
    await PostModel.updateStatus(reviewRequest.post_id, PostStatus.PUBLISHING);

    logger.info(`Test post ${reviewRequest.post_id} approved, publishing immediately...`);

    // Publish immediately (not queued)
    const threadsService = (await import('../services/threads.service')).default;
    const { PostModel: PM } = await import('../models/post.model');
    const { AuditModel } = await import('../models/audit.model');

    let publishResult: { id: string; permalink: string };
    let accountId: string | undefined;

    // CRITICAL SECTION: Only publish can cause failure
    try {
      // Get revision content
      const revision = await PM.findRevisionById(reviewRequest.revision_id);
      if (!revision) {
        throw new Error('Revision not found');
      }

      // Get Threads account and token
      const accountData = await threadsService.getDefaultAccount();
      if (!accountData) {
        throw new Error('No active Threads account found');
      }

      accountId = accountData.account.id;

      // Publish to Threads
      publishResult = await threadsService.createPost(
        accountData.account.account_id,
        accountData.token,
        revision.content,
        accountData.account.username
      );

      logger.info(`✅ Test post ${reviewRequest.post_id} published successfully to Threads: ${publishResult.permalink}`);
    } catch (error: any) {
      logger.error(`❌ Failed to publish test post ${reviewRequest.post_id}:`, error);

      // Update post status to FAILED
      await PM.updateStatus(reviewRequest.post_id, PostStatus.FAILED, {
        last_error_message: error.message,
      });

      // Send error notification to LINE
      await lineService.sendNotification(
        lineUserId as string,
        `❌ 發布失敗！\n\n錯誤訊息：${error.message}\n\n請檢查 Threads 帳號設定或稍後重試。`
      );

      throw error;
    }

    // POST-PUBLISH OPERATIONS: These failures should not mark the post as failed
    // since the post is already live on Threads

    // Update post status to POSTED
    try {
      await PM.updateStatus(reviewRequest.post_id, PostStatus.POSTED, {
        posted_at: new Date(),
        post_url: publishResult.permalink,
      });
    } catch (error: any) {
      logger.error(`Failed to update post status (post was published successfully):`, error);
    }

    // Log audit
    try {
      await AuditModel.log({
        action: 'post_published',
        target_type: 'post',
        target_id: reviewRequest.post_id,
        metadata: {
          revision_id: reviewRequest.revision_id,
          account_id: accountId,
          post_url: publishResult.permalink,
          threads_post_id: publishResult.id,
        },
      });
    } catch (error: any) {
      logger.error(`Failed to log audit (post was published successfully):`, error);
    }

    // Send success notification to LINE
    try {
      await lineService.sendNotification(
        lineUserId as string,
        `✅ 測試文章已成功發布到 Threads！\n\n🔗 文章連結：\n${publishResult.permalink}\n\n已存入 MySQL 資料庫。`
      );
    } catch (error: any) {
      logger.error(`Failed to send LINE notification (post was published successfully):`, error);
    }

    res.send(`
      <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px; background: #f5f5f5;">
          <div style="background: white; padding: 40px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); max-width: 500px; margin: 0 auto;">
            <h1 style="color: #1DB446;">✅ 發布成功！</h1>
            <p style="color: #666; font-size: 16px; line-height: 1.6;">
              測試文章已成功發布到 Threads<br>
              並存入 MySQL 資料庫
            </p>
            <p style="color: #999; font-size: 14px; margin-top: 30px;">
              您可以關閉此頁面並返回 LINE 查看文章連結
            </p>
          </div>
        </body>
      </html>
    `);
  } catch (error: any) {
    logger.error('Failed to approve test post:', error);
    res.status(500).send('處理失敗: ' + error.message);
  }
});

router.get('/review/test-regenerate', async (req: Request, res: Response): Promise<void> => {
  try {
    const { postId, lineUserId } = req.query;

    if (!postId || !lineUserId) {
      res.status(400).send('缺少參數');
      return;
    }

    const contentService = (await import('../services/content.service')).default;
    const lineService = (await import('../services/line.service')).default;
    const { PostModel } = await import('../models/post.model');
    const { PostStatus } = await import('../types');
    const { SettingsModel } = await import('../models/settings.model');
    const { getPool } = await import('../database/connection');
    const { generateUUID } = await import('../utils/uuid');

    logger.info(`Regenerating test post ${postId}`);

    // Get post
    const post = await PostModel.findById(postId as string);
    if (!post) {
      res.status(404).send('找不到文章');
      return;
    }

    // Get settings for regeneration
    const customPrompt = await SettingsModel.get('custom_prompt');
    const aiEngine = await SettingsModel.get('ai_engine');

    // Extract prompt string
    const promptString = typeof customPrompt === 'string'
      ? customPrompt
      : (customPrompt && typeof customPrompt === 'object' ? customPrompt.value : undefined);

    // Extract engine string from aiEngine
    const engineString = typeof aiEngine === 'string'
      ? aiEngine
      : (aiEngine && typeof aiEngine === 'object' ? aiEngine.value : undefined);

    // Convert string to EngineType enum properly
    const { EngineType } = await import('../types');
    const engineType = (engineString && typeof engineString === 'string' && engineString in EngineType)
      ? engineString as typeof EngineType[keyof typeof EngineType]
      : EngineType.GPT4O;

    // Update status to generating
    await PostModel.updateStatus(postId as string, PostStatus.GENERATING);

    // Send "regenerating" notification
    await lineService.sendNotification(
      lineUserId as string,
      '🔄 重新生成中...\n\n請稍候，新文章很快就會送達！'
    );

    // Regenerate content with specified engine
    const result = await contentService.regenerate(postId as string, {
      engine: engineType,
      systemPrompt: promptString || undefined,
      topic: '測試生成 - 重新產生',
    });

    logger.info(`Regenerated content for post ${postId}, similarity: ${result.similarityMax}`);

    // Create new review token
    const pool = getPool();
    const reviewToken = generateUUID();
    const reviewRequestId = generateUUID();

    // Cancel previous review requests for this post
    await pool.execute(
      'UPDATE review_requests SET status = \'CANCELLED\' WHERE post_id = ? AND status = \'PENDING\'',
      [postId]
    );

    // Find user by line_user_id
    const [userRows] = await pool.execute(
      'SELECT id FROM users WHERE line_user_id = ? LIMIT 1',
      [lineUserId]
    );

    if (userRows.length === 0) {
      logger.error(`No user found with LINE ID ${lineUserId}`);
      res.status(400).send('找不到對應的用戶');
      return;
    }

    const reviewerUserId = userRows[0].id;
    logger.info(`Found user with LINE ID ${lineUserId}: ${reviewerUserId}`);

    // Create new review request
    await pool.execute(
      `INSERT INTO review_requests (id, post_id, revision_id, reviewer_user_id, status, token, expires_at)
       VALUES (?, ?, ?, ?, 'PENDING', ?, DATE_ADD(NOW(), INTERVAL 7 DAY))`,
      [reviewRequestId, postId, result.revisionId, reviewerUserId, reviewToken]
    );

    logger.info(`Created new review request ${reviewRequestId} with token ${reviewToken}`);

    // Send new notification with updated content
    const config = (await import('../config')).default;

    await lineService.sendFlexMessage(lineUserId as string, {
      type: 'bubble',
      hero: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: '🔄 已重新生成',
            weight: 'bold',
            size: 'xl',
            color: '#1DB446',
          },
        ],
        paddingAll: 'lg',
      },
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: '📊 生成資訊',
            weight: 'bold',
            size: 'md',
            margin: 'none',
          },
          {
            type: 'text',
            text: `🤖 引擎: ${result.engine}`,
            size: 'sm',
            color: '#666666',
            margin: 'md',
          },
          {
            type: 'text',
            text: `📈 相似度: ${(result.similarityMax * 100).toFixed(1)}%`,
            size: 'sm',
            color: result.similarityMax > 0.86 ? '#FF0000' : '#666666',
            margin: 'xs',
          },
          {
            type: 'separator',
            margin: 'lg',
          },
          {
            type: 'text',
            text: '📝 文章內容',
            weight: 'bold',
            size: 'md',
            margin: 'lg',
          },
          {
            type: 'text',
            text: result.content.substring(0, 300) + (result.content.length > 300 ? '...' : ''),
            wrap: true,
            color: '#333333',
            margin: 'md',
            size: 'sm',
          },
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          {
            type: 'button',
            style: 'primary',
            height: 'sm',
            action: {
              type: 'uri',
              label: '✅ 確認發文到 Threads',
              uri: `${config.app.baseUrl}/api/review/test-approve?token=${reviewToken}&lineUserId=${lineUserId}`,
            },
          },
          {
            type: 'button',
            style: 'secondary',
            height: 'sm',
            action: {
              type: 'uri',
              label: '🔄 再次重新生成',
              uri: `${config.app.baseUrl}/api/review/test-regenerate?postId=${postId}&lineUserId=${lineUserId}`,
            },
          },
          {
            type: 'button',
            style: 'link',
            height: 'sm',
            action: {
              type: 'message',
              label: '✏️ 修改內容',
              text: '請直接輸入修改後的文章內容',
            },
          },
        ],
      },
    });

    logger.info(`Sent regenerated content notification for post ${postId}`);

    res.send(`
      <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px; background: #f5f5f5;">
          <div style="background: white; padding: 40px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); max-width: 500px; margin: 0 auto;">
            <h1 style="color: #1DB446;">🔄 重新生成完成！</h1>
            <p style="color: #666; font-size: 16px; line-height: 1.6;">
              新的測試文章已發送到 LINE<br>
              請到 LINE 查看新內容
            </p>
            <p style="color: #999; font-size: 14px; margin-top: 30px;">
              您可以關閉此頁面並返回 LINE
            </p>
          </div>
        </body>
      </html>
    `);
  } catch (error: any) {
    logger.error('Failed to regenerate test post:', error);
    res.status(500).send('處理失敗: ' + error.message);
  }
});

export default router;
