import { Router, Request, Response } from 'express';
import postController from '../controllers/post.controller';
import reviewController from '../controllers/review.controller';
import { authenticate, AuthRequest } from '../middlewares/auth.middleware';
import { UserModel } from '../models/user.model';
import jwt from 'jsonwebtoken';
import config from '../config';
import logger from '../utils/logger';
import { RowDataPacket } from 'mysql2';

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
    const engineType = (engineString && typeof engineString === 'string' && Object.values(EngineType).includes(engineString as any))
      ? (engineString as typeof EngineType[keyof typeof EngineType])
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
      const [userRows] = await pool.execute<RowDataPacket[]>(
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
        if (editedText.toLowerCase() === '/id') {
          await lineService.sendNotification(
            lineUserId,
            `📱 您的 LINE User ID:\n${lineUserId}\n\n請複製此 ID 並貼到網站的「自動化發文設定」→「LINE 通知設定」中，系統才能將審核通知發送給您。`
          );
          continue;
        }

        if (editedText.toLowerCase() === '/s') {
          const pool = getPool();
          const { SettingsModel } = await import('../models/settings.model');
          const scheduleConfig = await SettingsModel.get('schedule_config');
          const lineNotifyUserId = await SettingsModel.get('line_notify_user_id');

          if (!scheduleConfig) {
            await lineService.sendNotification(
              lineUserId,
              '⚠️ 尚未設定排程\n\n請前往網頁管理介面設定自動發文排程。'
            );
            continue;
          }

          // Get Threads account info
          let threadsAccountInfo = '未連結 Threads 帳號';
          try {
            const [accounts] = await pool.execute<RowDataPacket[]>(
              `SELECT ta.username, ta.account_id
               FROM threads_accounts ta
               INNER JOIN threads_auth t ON ta.id = t.account_id
               WHERE t.status = 'OK' AND ta.status = 'ACTIVE'
               LIMIT 1`
            );

            if (accounts.length > 0) {
              threadsAccountInfo = `@${accounts[0].username}`;
            }
          } catch (error) {
            logger.error('Failed to get Threads account info:', error);
          }

          // Get LINE User info
          let lineUserInfo = '未設定';
          if (lineNotifyUserId) {
            try {
              const [users] = await pool.execute<RowDataPacket[]>(
                'SELECT name, email FROM users WHERE line_user_id = ? LIMIT 1',
                [lineNotifyUserId]
              );

              if (users.length > 0) {
                lineUserInfo = users[0].name || users[0].email;
              }
            } catch (error) {
              logger.error('Failed to get LINE user info:', error);
            }
          }

          // Format schedule information
          const dayNames: Record<string, string> = {
            monday: '星期一',
            tuesday: '星期二',
            wednesday: '星期三',
            thursday: '星期四',
            friday: '星期五',
            saturday: '星期六',
            sunday: '星期日',
          };

          const enabledSchedules: string[] = [];
          const disabledDays: string[] = [];

          for (const [day, config] of Object.entries(scheduleConfig)) {
            const dayConfig = config as { enabled: boolean; time: string };
            if (dayConfig.enabled) {
              enabledSchedules.push(`${dayNames[day]} ${dayConfig.time}`);
            } else {
              disabledDays.push(dayNames[day]);
            }
          }

          let message = '📅 自動發文排程\n\n';

          message += `📢 發文帳號：${threadsAccountInfo}\n`;
          message += `👤 管理員：${lineUserInfo}\n\n`;

          if (enabledSchedules.length > 0) {
            message += '✅ 已啟用：\n';
            enabledSchedules.forEach(schedule => {
              message += `  • ${schedule}\n`;
            });
          } else {
            message += '⚠️ 目前沒有啟用任何排程\n';
          }

          if (disabledDays.length > 0) {
            message += `\n❌ 未啟用：${disabledDays.join('、')}`;
          }

          await lineService.sendNotification(lineUserId, message);
          continue;
        }

        if (editedText.toLowerCase() === '/data') {
          const pool = getPool();
          const threadsService = (await import('../services/threads.service')).default;
          const { InsightsModel } = await import('../models/insights.model');
          const { PeriodType } = await import('../types');

          try {
            // Get default Threads account
            const defaultAccount = await threadsService.getDefaultAccount();
            if (!defaultAccount) {
              await lineService.sendNotification(
                lineUserId,
                '⚠️ 未連結 Threads 帳號\n\n請前往網頁管理介面連結您的 Threads 帳號。'
              );
              continue;
            }

            const accountId = defaultAccount.account.id;

            // Get latest weekly insights
            const weeklyInsights = await InsightsModel.getAccountInsights(accountId, PeriodType.WEEKLY);

            // Get recent posts stats (last 7 days)
            const sevenDaysAgo = new Date();
            sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

            const [recentPostsStats] = await pool.execute<RowDataPacket[]>(
              `SELECT
                COUNT(DISTINCT p.id) as post_count,
                COALESCE(SUM(pi.views), 0) as total_views,
                COALESCE(SUM(pi.likes), 0) as total_likes,
                COALESCE(SUM(pi.replies), 0) as total_replies,
                COALESCE(SUM(pi.reposts), 0) as total_reposts
               FROM posts p
               LEFT JOIN post_insights pi ON p.id = pi.post_id
               WHERE p.status = 'POSTED' AND p.posted_at >= ?`,
              [sevenDaysAgo]
            );

            const stats = recentPostsStats[0];

            // Get top performing post
            const [topPost] = await pool.execute<RowDataPacket[]>(
              `SELECT p.id, p.post_url, pi.views, pi.likes, pi.engagement_rate
               FROM posts p
               INNER JOIN post_insights pi ON p.id = pi.post_id
               WHERE p.status = 'POSTED' AND p.posted_at >= ?
               ORDER BY pi.engagement_rate DESC
               LIMIT 1`,
              [sevenDaysAgo]
            );

            let message = '📊 數據監控總覽\n\n';
            message += `📢 帳號：@${defaultAccount.account.username}\n\n`;

            message += '📈 過去 7 天統計：\n';
            message += `  • 發文數：${stats.post_count} 篇\n`;
            message += `  • 總瀏覽：${stats.total_views.toLocaleString()} 次\n`;
            message += `  • 按讚數：${stats.total_likes.toLocaleString()}\n`;
            message += `  • 回覆數：${stats.total_replies.toLocaleString()}\n`;
            message += `  • 轉發數：${stats.total_reposts.toLocaleString()}\n\n`;

            if (weeklyInsights) {
              message += '👥 帳號數據：\n';
              message += `  • 追蹤者：${weeklyInsights.followers_count.toLocaleString()}\n`;
              message += `  • 新增粉絲：${weeklyInsights.period_new_followers > 0 ? '+' : ''}${weeklyInsights.period_new_followers}\n\n`;
            }

            if (topPost.length > 0) {
              const top = topPost[0];
              message += '🏆 最佳表現：\n';
              message += `  • 互動率：${top.engagement_rate}%\n`;
              message += `  • 瀏覽數：${top.views.toLocaleString()}\n`;
              message += `  • 按讚數：${top.likes.toLocaleString()}\n`;
              message += `  • 連結：${top.post_url}\n`;
            }

            await lineService.sendNotification(lineUserId, message);
          } catch (error) {
            logger.error('Failed to get analytics data for /data command:', error);
            await lineService.sendNotification(
              lineUserId,
              '❌ 無法獲取數據\n\n可能尚未同步 Threads 數據。\n請稍後再試或聯繫管理員。'
            );
          }
          continue;
        }

        // Find pending review for this user
        const pool = getPool();
        const [rows] = await pool.execute<RowDataPacket[]>(
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
                    uri: `${config.app.baseUrl}/api/review/approve-edited?token=${reviewRequest.token}&lineUserId=${lineUserId}`,
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
    const [rows] = await pool.execute<RowDataPacket[]>(
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
    const [originalRevision] = await pool.execute<RowDataPacket[]>(
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

// Analytics routes
router.get('/analytics/posts/:postId', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const { postId } = req.params;
    const { InsightsModel } = await import('../models/insights.model');

    const insights = await InsightsModel.getPostInsights(postId);

    if (!insights) {
      res.status(404).json({ error: 'No insights found for this post' });
      return;
    }

    res.json({ success: true, insights });
  } catch (error: any) {
    logger.error('Failed to get post insights:', error);
    res.status(500).json({ error: 'Failed to get insights', message: error.message });
  }
});

router.get('/analytics/posts/:postId/history', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const { postId } = req.params;
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 30;
    const { InsightsModel } = await import('../models/insights.model');

    const history = await InsightsModel.getPostInsightsHistory(postId, limit);

    res.json({ success: true, history });
  } catch (error: any) {
    logger.error('Failed to get post insights history:', error);
    res.status(500).json({ error: 'Failed to get insights history', message: error.message });
  }
});

router.get('/analytics/account/:accountId', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const { accountId } = req.params;
    const { PeriodType } = await import('../types');
    const periodType = (req.query.period as keyof typeof PeriodType) || 'WEEKLY';
    const { InsightsModel } = await import('../models/insights.model');

    const insights = await InsightsModel.getAccountInsights(accountId, PeriodType[periodType]);

    if (!insights) {
      res.status(404).json({ error: 'No insights found for this account' });
      return;
    }

    res.json({ success: true, insights });
  } catch (error: any) {
    logger.error('Failed to get account insights:', error);
    res.status(500).json({ error: 'Failed to get insights', message: error.message });
  }
});

router.get('/analytics/account/:accountId/history', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const { accountId } = req.params;
    const { PeriodType } = await import('../types');
    const periodType = (req.query.period as keyof typeof PeriodType) || 'WEEKLY';
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 12;
    const { InsightsModel } = await import('../models/insights.model');

    const history = await InsightsModel.getAccountInsightsHistory(accountId, PeriodType[periodType], limit);

    res.json({ success: true, history });
  } catch (error: any) {
    logger.error('Failed to get account insights history:', error);
    res.status(500).json({ error: 'Failed to get insights history', message: error.message });
  }
});

router.get('/analytics/summary', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const { getPool } = await import('../database/connection');
    const threadsService = (await import('../services/threads.service')).default;
    const { InsightsModel } = await import('../models/insights.model');
    const { PeriodType } = await import('../types');

    // Get default Threads account
    const defaultAccount = await threadsService.getDefaultAccount();
    if (!defaultAccount) {
      res.status(404).json({ error: 'No active Threads account found' });
      return;
    }

    const accountId = defaultAccount.account.id;

    // Get latest account insights for different periods
    const weeklyInsights = await InsightsModel.getAccountInsights(accountId, PeriodType.WEEKLY);
    const monthlyInsights = await InsightsModel.getAccountInsights(accountId, PeriodType.MONTHLY);

    // Get recent posts with insights
    const pool = getPool();
    const [recentPosts] = await pool.execute<RowDataPacket[]>(
      `SELECT p.id, p.posted_at, p.post_url, pi.views, pi.likes, pi.replies, pi.reposts, pi.engagement_rate
       FROM posts p
       LEFT JOIN post_insights pi ON p.id = pi.post_id
       WHERE p.status = 'POSTED' AND p.posted_at IS NOT NULL
       ORDER BY p.posted_at DESC
       LIMIT 10`
    );

    res.json({
      success: true,
      summary: {
        account: {
          username: defaultAccount.account.username,
          id: accountId,
        },
        weekly: weeklyInsights,
        monthly: monthlyInsights,
        recentPosts,
      },
    });
  } catch (error: any) {
    logger.error('Failed to get analytics summary:', error);
    res.status(500).json({ error: 'Failed to get summary', message: error.message });
  }
});

router.post('/analytics/sync', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const { postId, accountId, type } = req.body;
    const threadsInsightsService = (await import('../services/threads-insights.service')).default;

    if (type === 'post' && postId) {
      const success = await threadsInsightsService.syncPostInsights(postId);
      if (success) {
        res.json({ success: true, message: 'Post insights synced successfully' });
      } else {
        res.status(500).json({ error: 'Failed to sync post insights' });
      }
    } else if (type === 'account' && accountId) {
      const { PeriodType } = await import('../types');
      const periodType = req.body.period || PeriodType.WEEKLY;
      const success = await threadsInsightsService.syncAccountInsights(accountId, periodType);
      if (success) {
        res.json({ success: true, message: 'Account insights synced successfully' });
      } else {
        res.status(500).json({ error: 'Failed to sync account insights' });
      }
    } else if (type === 'recent') {
      const days = req.body.days || 7;
      const limit = req.body.limit || 50;
      await threadsInsightsService.syncRecentPostsInsights(days, limit);
      res.json({ success: true, message: 'Recent posts insights synced successfully' });
    } else {
      res.status(400).json({ error: 'Invalid sync type or missing parameters' });
    }
  } catch (error: any) {
    logger.error('Failed to sync insights:', error);
    res.status(500).json({ error: 'Failed to sync insights', message: error.message });
  }
});

// 智能排程 API 路由
// 用途：提供網頁介面手動建立排程的功能
// 影響範圍：新增路由，不影響現有功能

/**
 * GET /api/scheduling/templates
 * 用途：取得所有啟用的內容模板
 * 回傳：模板列表（包含名稱、描述、統計數據）
 */
router.get('/scheduling/templates', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const { getPool } = await import('../database/connection');
    const pool = getPool();

    // 查詢所有啟用的模板，按平均互動率排序
    const [templates] = await pool.execute<RowDataPacket[]>(
      `SELECT id, name, description, total_uses, avg_engagement_rate
       FROM content_templates
       WHERE enabled = true
       ORDER BY avg_engagement_rate DESC, name ASC`
    );

    res.json({
      success: true,
      templates,
    });
  } catch (error: any) {
    logger.error('Failed to get templates:', error);
    res.status(500).json({ error: '無法取得模板列表', message: error.message });
  }
});

/**
 * GET /api/scheduling/config
 * 用途：取得發文時段配置（19:00-22:30 等設定）
 * 回傳：時段配置資料
 */
router.get('/scheduling/config', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const { getPool } = await import('../database/connection');
    const pool = getPool();

    // 查詢啟用的排程配置
    const [configs] = await pool.execute<RowDataPacket[]>(
      `SELECT id, start_hour, start_minute, end_hour, end_minute,
              posts_per_day, active_days, enabled
       FROM posting_schedule_config
       WHERE enabled = true
       LIMIT 1`
    );

    if (configs.length === 0) {
      res.status(404).json({ error: '尚未設定排程配置' });
      return;
    }

    const config = configs[0];

    // 處理 active_days JSON 欄位（可能是字串或物件）
    if (typeof config.active_days === 'string') {
      config.active_days = JSON.parse(config.active_days);
    }

    res.json({
      success: true,
      config,
    });
  } catch (error: any) {
    logger.error('Failed to get scheduling config:', error);
    res.status(500).json({ error: '無法取得排程配置', message: error.message });
  }
});

/**
 * POST /api/scheduling/create
 * 用途：手動建立新的排程
 * Body: { templateId: string, scheduledTime: string (ISO 8601) }
 * 回傳：建立的排程資料
 */
router.post('/scheduling/create', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const { templateId, scheduledTime } = req.body;

    // 驗證必要參數
    if (!templateId || !scheduledTime) {
      res.status(400).json({ error: '缺少必要參數：templateId 或 scheduledTime' });
      return;
    }

    // 驗證時間格式
    const scheduleDate = new Date(scheduledTime);
    if (isNaN(scheduleDate.getTime())) {
      res.status(400).json({ error: '無效的時間格式' });
      return;
    }

    // 檢查時間不能是過去
    if (scheduleDate <= new Date()) {
      res.status(400).json({ error: '排程時間不能是過去的時間' });
      return;
    }

    const { getPool } = await import('../database/connection');
    const { generateUUID } = await import('../utils/uuid');
    const pool = getPool();

    // 驗證模板存在且啟用
    const [templates] = await pool.execute<RowDataPacket[]>(
      'SELECT id, name FROM content_templates WHERE id = ? AND enabled = true',
      [templateId]
    );

    if (templates.length === 0) {
      res.status(404).json({ error: '模板不存在或已停用' });
      return;
    }

    // 驗證時間在允許範圍內（根據配置）
    const [configs] = await pool.execute<RowDataPacket[]>(
      `SELECT start_hour, start_minute, end_hour, end_minute, active_days
       FROM posting_schedule_config
       WHERE enabled = true
       LIMIT 1`
    );

    if (configs.length > 0) {
      const config = configs[0];
      const scheduleHour = scheduleDate.getHours();
      const scheduleMinute = scheduleDate.getMinutes();
      const scheduleDayOfWeek = scheduleDate.getDay(); // 0=日, 1=一, ..., 6=六

      // 檢查時段
      const startTimeMinutes = config.start_hour * 60 + config.start_minute;
      const endTimeMinutes = config.end_hour * 60 + config.end_minute;
      const scheduleTimeMinutes = scheduleHour * 60 + scheduleMinute;

      if (scheduleTimeMinutes < startTimeMinutes || scheduleTimeMinutes > endTimeMinutes) {
        const startTime = `${String(config.start_hour).padStart(2, '0')}:${String(config.start_minute).padStart(2, '0')}`;
        const endTime = `${String(config.end_hour).padStart(2, '0')}:${String(config.end_minute).padStart(2, '0')}`;
        res.status(400).json({
          error: `排程時間必須在 ${startTime} - ${endTime} 之間`
        });
        return;
      }

      // 檢查星期
      const activeDays = typeof config.active_days === 'string'
        ? JSON.parse(config.active_days)
        : config.active_days;

      if (!activeDays.includes(scheduleDayOfWeek)) {
        const dayNames = ['日', '一', '二', '三', '四', '五', '六'];
        res.status(400).json({
          error: `星期${dayNames[scheduleDayOfWeek]}未啟用發文排程`
        });
        return;
      }
    }

    // 檢查是否已有相同時間的排程（UNIQUE 約束也會阻止，這裡提供更友善的錯誤訊息）
    const [existing] = await pool.execute<RowDataPacket[]>(
      `SELECT id FROM daily_scheduled_posts
       WHERE scheduled_time = ? AND status IN ('PENDING', 'GENERATED')`,
      [scheduledTime]
    );

    if (existing.length > 0) {
      res.status(409).json({ error: '該時間已有排程，請選擇其他時間' });
      return;
    }

    // 建立排程
    const scheduleId = generateUUID();
    await pool.execute(
      `INSERT INTO daily_scheduled_posts
       (id, template_id, scheduled_time, status, selection_method, created_at)
       VALUES (?, ?, ?, 'PENDING', 'MANUAL', NOW())`,
      [scheduleId, templateId, scheduledTime]
    );

    logger.info(`Created manual schedule: ${scheduleId} at ${scheduledTime} with template ${templateId}`);

    // 回傳建立的排程資料
    const [created] = await pool.execute<RowDataPacket[]>(
      `SELECT ds.*, ct.name as template_name, ct.description as template_description
       FROM daily_scheduled_posts ds
       JOIN content_templates ct ON ds.template_id = ct.id
       WHERE ds.id = ?`,
      [scheduleId]
    );

    res.json({
      success: true,
      message: '排程建立成功',
      schedule: created[0],
    });
  } catch (error: any) {
    logger.error('Failed to create schedule:', error);

    // 處理資料庫唯一約束錯誤
    if (error.code === 'ER_DUP_ENTRY') {
      res.status(409).json({ error: '該時間已有排程，請選擇其他時間' });
      return;
    }

    res.status(500).json({ error: '無法建立排程', message: error.message });
  }
});

/**
 * GET /api/scheduling/upcoming
 * 用途：查看待發布的排程列表
 * Query: limit (optional, default 20) - 限制回傳數量
 * 回傳：排程列表（包含模板資訊）
 */
router.get('/scheduling/upcoming', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 20;

    const { getPool } = await import('../database/connection');
    const pool = getPool();

    // 查詢待發布的排程，聯結模板資訊
    const [schedules] = await pool.execute<RowDataPacket[]>(
      `SELECT
         ds.id,
         ds.template_id,
         ds.scheduled_time,
         ds.status,
         ds.selection_method,
         ds.created_at,
         ct.name as template_name,
         ct.description as template_description,
         ct.avg_engagement_rate as template_performance
       FROM daily_scheduled_posts ds
       JOIN content_templates ct ON ds.template_id = ct.id
       WHERE ds.status IN ('PENDING', 'GENERATED')
         AND ds.scheduled_time >= NOW()
       ORDER BY ds.scheduled_time ASC
       LIMIT ?`,
      [limit]
    );

    res.json({
      success: true,
      schedules,
      count: schedules.length,
    });
  } catch (error: any) {
    logger.error('Failed to get upcoming schedules:', error);
    res.status(500).json({ error: '無法取得排程列表', message: error.message });
  }
});

/**
 * DELETE /api/scheduling/:id
 * 用途：刪除排程（僅限 PENDING 狀態）
 * 回傳：成功訊息
 */
router.delete('/scheduling/:id', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const { getPool } = await import('../database/connection');
    const pool = getPool();

    // 檢查排程是否存在且為 PENDING 狀態
    const [schedules] = await pool.execute<RowDataPacket[]>(
      'SELECT id, status FROM daily_scheduled_posts WHERE id = ?',
      [id]
    );

    if (schedules.length === 0) {
      res.status(404).json({ error: '找不到該排程' });
      return;
    }

    const schedule = schedules[0];

    // 只允許刪除 PENDING 狀態的排程
    if (schedule.status !== 'PENDING') {
      res.status(400).json({
        error: `無法刪除狀態為 ${schedule.status} 的排程，僅能刪除待執行 (PENDING) 的排程`
      });
      return;
    }

    // 刪除排程
    await pool.execute(
      'DELETE FROM daily_scheduled_posts WHERE id = ?',
      [id]
    );

    logger.info(`Deleted schedule: ${id}`);

    res.json({
      success: true,
      message: '排程已刪除',
    });
  } catch (error: any) {
    logger.error('Failed to delete schedule:', error);
    res.status(500).json({ error: '無法刪除排程', message: error.message });
  }
});

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

    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT rr.*, u.line_user_id
       FROM review_requests rr
       JOIN users u ON rr.reviewer_user_id = u.id
       WHERE rr.token = ? AND u.line_user_id = ? AND rr.status = 'PENDING'`,
      [token, lineUserId]
    );

    logger.info(`Found ${rows.length} matching review requests`);

    if (rows.length === 0) {
      // Try to find the review request to see what's wrong
      const [allReviews] = await pool.execute<RowDataPacket[]>(
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
    const engineType = (engineString && typeof engineString === 'string' && Object.values(EngineType).includes(engineString as any))
      ? (engineString as typeof EngineType[keyof typeof EngineType])
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
    const [userRows] = await pool.execute<RowDataPacket[]>(
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

// ==================== UCB 智能排程系統 API ====================
// 用途：提供模板管理、時段配置、UCB 配置等完整功能
// 影響：新增路由，不影響現有功能

/**
 * GET /api/templates
 * 用途：取得所有內容模板
 * 回傳：模板列表（包含統計數據）
 */
router.get('/templates', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const { getPool } = await import('../database/connection');
    const pool = getPool();

    const [templates] = await pool.execute<RowDataPacket[]>(
      `SELECT id, name, prompt, description, enabled,
              total_uses, total_views, total_engagement, avg_engagement_rate,
              created_at, updated_at
       FROM content_templates
       ORDER BY avg_engagement_rate DESC, name ASC`
    );

    res.json({
      success: true,
      templates,
    });
  } catch (error: any) {
    logger.error('Failed to get templates:', error);
    res.status(500).json({ error: '無法取得模板列表', message: error.message });
  }
});

/**
 * POST /api/templates
 * 用途：建立新的內容模板
 * 請求：{ name, prompt, description }
 */
router.post('/templates', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, prompt, description, preferred_engine } = req.body;

    if (!name || !prompt) {
      res.status(400).json({ error: '模板名稱和提示詞為必填欄位' });
      return;
    }

    const { getPool } = await import('../database/connection');
    const { generateUUID } = await import('../utils/uuid');
    const pool = getPool();

    const id = generateUUID();

    await pool.execute(
      `INSERT INTO content_templates (id, name, prompt, description, preferred_engine, enabled)
       VALUES (?, ?, ?, ?, ?, true)`,
      [id, name, prompt, description || null, preferred_engine || 'GPT5_2']
    );

    logger.info(`Created template: ${name} (${id}) with engine: ${preferred_engine || 'GPT5_2'}`);

    res.json({
      success: true,
      template: {
        id,
        name,
        prompt,
        description,
        preferred_engine: preferred_engine || 'GPT5_2',
        enabled: true,
        total_uses: 0,
        avg_engagement_rate: 0,
      },
    });
  } catch (error: any) {
    logger.error('Failed to create template:', error);
    res.status(500).json({ error: '無法建立模板', message: error.message });
  }
});

/**
 * PUT /api/templates/:id
 * 用途：更新模板
 * 請求：{ name, prompt, description, enabled }
 */
router.put('/templates/:id', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { name, prompt, description, preferred_engine, enabled } = req.body;

    const { getPool } = await import('../database/connection');
    const pool = getPool();

    // 檢查模板是否存在
    const [existing] = await pool.execute<RowDataPacket[]>('SELECT id FROM content_templates WHERE id = ?', [id]);

    if ((existing as any[]).length === 0) {
      res.status(404).json({ error: '模板不存在' });
      return;
    }

    // 更新模板
    await pool.execute(
      `UPDATE content_templates
       SET name = ?, prompt = ?, description = ?, preferred_engine = ?, enabled = ?
       WHERE id = ?`,
      [name, prompt, description || null, preferred_engine || 'GPT5_2', enabled !== undefined ? enabled : true, id]
    );

    logger.info(`Updated template: ${id} with engine: ${preferred_engine || 'GPT5_2'}`);

    res.json({
      success: true,
      message: '模板已更新',
    });
  } catch (error: any) {
    logger.error('Failed to update template:', error);
    res.status(500).json({ error: '無法更新模板', message: error.message });
  }
});

/**
 * DELETE /api/templates/:id
 * 用途：刪除模板
 */
router.delete('/templates/:id', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const { getPool } = await import('../database/connection');
    const pool = getPool();

    // 檢查是否有使用中的排程
    const [schedules] = await pool.execute<RowDataPacket[]>(
      'SELECT id FROM daily_auto_schedule WHERE selected_template_id = ? AND status = "PENDING"',
      [id]
    );

    if ((schedules as any[]).length > 0) {
      res.status(400).json({ error: '無法刪除：該模板有待執行的排程' });
      return;
    }

    // 刪除模板
    await pool.execute('DELETE FROM content_templates WHERE id = ?', [id]);

    logger.info(`Deleted template: ${id}`);

    res.json({
      success: true,
      message: '模板已刪除',
    });
  } catch (error: any) {
    logger.error('Failed to delete template:', error);
    res.status(500).json({ error: '無法刪除模板', message: error.message });
  }
});

/**
 * GET /api/time-slots
 * 用途：取得所有時段配置
 */
router.get('/time-slots', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const { getPool } = await import('../database/connection');
    const pool = getPool();

    const [slots] = await pool.execute<RowDataPacket[]>(
      `SELECT id, name, start_hour, start_minute, end_hour, end_minute,
              allowed_template_ids, active_days, enabled, priority,
              created_at, updated_at
       FROM schedule_time_slots
       ORDER BY priority DESC, start_hour ASC`
    );

    // 解析 JSON 欄位
    const parsedSlots = (slots as any[]).map((slot) => ({
      ...slot,
      allowed_template_ids: JSON.parse(slot.allowed_template_ids),
      active_days: JSON.parse(slot.active_days),
    }));

    res.json({
      success: true,
      timeSlots: parsedSlots,
    });
  } catch (error: any) {
    logger.error('Failed to get time slots:', error);
    res.status(500).json({ error: '無法取得時段列表', message: error.message });
  }
});

/**
 * POST /api/time-slots
 * 用途：建立新的時段配置
 */
router.post('/time-slots', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, start_hour, start_minute, end_hour, end_minute, allowed_template_ids, active_days, priority } =
      req.body;

    if (!name || start_hour === undefined || end_hour === undefined) {
      res.status(400).json({ error: '必填欄位不完整' });
      return;
    }

    const { getPool } = await import('../database/connection');
    const { generateUUID } = await import('../utils/uuid');
    const pool = getPool();

    const id = generateUUID();

    await pool.execute(
      `INSERT INTO schedule_time_slots
       (id, name, start_hour, start_minute, end_hour, end_minute,
        allowed_template_ids, active_days, enabled, priority)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, true, ?)`,
      [
        id,
        name,
        start_hour,
        start_minute || 0,
        end_hour,
        end_minute || 0,
        JSON.stringify(allowed_template_ids || []),
        JSON.stringify(active_days || [1, 2, 3, 4, 5, 6, 7]),
        priority || 0,
      ]
    );

    logger.info(`Created time slot: ${name} (${id})`);

    res.json({
      success: true,
      timeSlot: { id, name },
    });
  } catch (error: any) {
    logger.error('Failed to create time slot:', error);
    res.status(500).json({ error: '無法建立時段', message: error.message });
  }
});

/**
 * PUT /api/time-slots/:id
 * 用途：更新時段配置
 */
router.put('/time-slots/:id', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { name, start_hour, start_minute, end_hour, end_minute, allowed_template_ids, active_days, enabled, priority } =
      req.body;

    const { getPool } = await import('../database/connection');
    const pool = getPool();

    await pool.execute(
      `UPDATE schedule_time_slots
       SET name = ?, start_hour = ?, start_minute = ?, end_hour = ?, end_minute = ?,
           allowed_template_ids = ?, active_days = ?, enabled = ?, priority = ?
       WHERE id = ?`,
      [
        name,
        start_hour,
        start_minute,
        end_hour,
        end_minute,
        JSON.stringify(allowed_template_ids),
        JSON.stringify(active_days),
        enabled !== undefined ? enabled : true,
        priority || 0,
        id,
      ]
    );

    logger.info(`Updated time slot: ${id}`);

    res.json({
      success: true,
      message: '時段已更新',
    });
  } catch (error: any) {
    logger.error('Failed to update time slot:', error);
    res.status(500).json({ error: '無法更新時段', message: error.message });
  }
});

/**
 * DELETE /api/time-slots/:id
 * 用途：刪除時段配置
 */
router.delete('/time-slots/:id', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const { getPool } = await import('../database/connection');
    const pool = getPool();

    await pool.execute('DELETE FROM schedule_time_slots WHERE id = ?', [id]);

    logger.info(`Deleted time slot: ${id}`);

    res.json({
      success: true,
      message: '時段已刪除',
    });
  } catch (error: any) {
    logger.error('Failed to delete time slot:', error);
    res.status(500).json({ error: '無法刪除時段', message: error.message });
  }
});

/**
 * GET /api/ucb-config
 * 用途：取得 UCB 配置
 */
router.get('/ucb-config', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const { ucbService } = await import('../services/ucb.service');
    const config = await ucbService.getConfig();

    res.json({
      success: true,
      config,
    });
  } catch (error: any) {
    logger.error('Failed to get UCB config:', error);
    res.status(500).json({ error: '無法取得配置', message: error.message });
  }
});

/**
 * PUT /api/ucb-config
 * 用途：更新 UCB 配置
 */
router.put('/ucb-config', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      exploration_factor,
      min_trials_per_template,
      posts_per_day,
      auto_schedule_enabled,
      threads_account_id,
      line_user_id,
      time_range_start,
      time_range_end
    } = req.body;

    const { getPool } = await import('../database/connection');
    const { generateUUID } = await import('../utils/uuid');
    const pool = getPool();

    // 檢查是否已有配置
    const [existing] = await pool.execute<RowDataPacket[]>('SELECT id FROM smart_schedule_config WHERE enabled = true LIMIT 1');

    if ((existing as any[]).length === 0) {
      // 建立新配置
      const id = generateUUID();
      await pool.execute(
        `INSERT INTO smart_schedule_config
         (id, exploration_factor, min_trials_per_template, posts_per_day, auto_schedule_enabled,
          threads_account_id, line_user_id, time_range_start, time_range_end, enabled)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, true)`,
        [
          id,
          exploration_factor || 1.5,
          min_trials_per_template || 5,
          posts_per_day || 1,
          auto_schedule_enabled !== false,
          threads_account_id || null,
          line_user_id || null,
          time_range_start || '09:00:00',
          time_range_end || '21:00:00'
        ]
      );
    } else {
      // 更新現有配置
      await pool.execute(
        `UPDATE smart_schedule_config
         SET exploration_factor = ?,
             min_trials_per_template = ?,
             posts_per_day = ?,
             auto_schedule_enabled = ?,
             threads_account_id = ?,
             line_user_id = ?,
             time_range_start = ?,
             time_range_end = ?
         WHERE enabled = true`,
        [
          exploration_factor || 1.5,
          min_trials_per_template || 5,
          posts_per_day || 1,
          auto_schedule_enabled !== false,
          threads_account_id || null,
          line_user_id || null,
          time_range_start || '09:00:00',
          time_range_end || '21:00:00'
        ]
      );
    }

    // 同步更新使用者的 LINE User ID (關鍵修正!)
    // 當設定了 line_user_id 時,找到對應的使用者並更新其 line_user_id 欄位
    if (line_user_id) {
      const [users] = await pool.execute<RowDataPacket[]>(
        `SELECT id FROM users WHERE line_user_id = ? OR email = ? LIMIT 1`,
        [line_user_id, 'admin@example.com']
      );

      if (users.length > 0) {
        // 使用者已存在,更新 LINE User ID
        await pool.execute(
          `UPDATE users SET line_user_id = ? WHERE id = ?`,
          [line_user_id, users[0].id]
        );
        logger.info(`Updated LINE User ID for user ${users[0].id}`);
      } else {
        // 預設更新 admin 帳號
        await pool.execute(
          `UPDATE users SET line_user_id = ? WHERE email = ?`,
          [line_user_id, 'admin@example.com']
        );
        logger.info(`Updated LINE User ID for admin user`);
      }
    }

    logger.info('Updated UCB config with account and notification settings');

    res.json({
      success: true,
      message: 'UCB 配置已更新',
    });
  } catch (error: any) {
    logger.error('Failed to update UCB config:', error);
    res.status(500).json({ error: '無法更新配置', message: error.message });
  }
});

/**
 * POST /api/line/test-notification
 * 用途：測試 LINE 通知功能
 */
router.post('/line/test-notification', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const { lineUserId } = req.body;

    if (!lineUserId) {
      res.status(400).json({ error: '缺少 LINE User ID' });
      return;
    }

    const lineService = (await import('../services/line.service')).default;

    await lineService.sendNotification(
      lineUserId,
      '✅ 測試訊息\n\n這是來自 Threads 自動發文系統的測試通知。\n如果您收到此訊息，表示 LINE 通知設定成功！\n\n🤖 系統將在生成文章後發送審核通知到此帳號。'
    );

    logger.info(`Sent test notification to LINE User ID: ${lineUserId}`);

    res.json({
      success: true,
      message: '測試訊息已發送',
    });
  } catch (error: any) {
    logger.error('Failed to send test LINE notification:', error);
    res.status(500).json({ error: '發送測試訊息失敗', message: error.message });
  }
});

/**
 * GET /api/auto-schedules
 * 用途：取得自動排程歷史
 */
router.get('/auto-schedules', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const { getPool } = await import('../database/connection');
    const pool = getPool();

    logger.info('Fetching auto schedules...');

    const [schedules] = await pool.execute<RowDataPacket[]>(
      `SELECT das.*,
              ct.name as template_name,
              sts.name as time_slot_name
       FROM daily_auto_schedule das
       LEFT JOIN content_templates ct ON das.selected_template_id = ct.id
       LEFT JOIN schedule_time_slots sts ON das.selected_time_slot_id = sts.id
       ORDER BY das.schedule_date DESC
       LIMIT 30`
    );

    logger.info(`Retrieved ${(schedules as any[]).length} auto schedules`);

    res.json({
      success: true,
      schedules,
    });
  } catch (error: any) {
    logger.error('Failed to get auto schedules:', error);
    // Provide more detailed error message for debugging
    const errorMessage = error.code === 'ER_NO_SUCH_TABLE'
      ? '資料表不存在，可能需要執行資料庫遷移 (npm run migrate)'
      : error.message;
    res.status(500).json({
      error: '無法取得排程歷史',
      message: errorMessage,
      details: error.code || error.name
    });
  }
});

/**
 * POST /api/trigger-daily-schedule
 * 用途：快速測試內容生成和 LINE 通知流程（測試用）
 * 說明：此功能完全獨立於 UCB 排程系統，用於測試整個審核發布流程
 */
router.post('/trigger-daily-schedule', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const { getPool } = await import('../database/connection');
    const pool = getPool();
    const { PostModel } = await import('../models/post.model');
    const { PostStatus } = await import('../types');
    const queueService = (await import('../services/queue.service')).default;

    logger.info('🧪 Quick test: Generating content for LINE approval test');

    // 從 UCB 配置取得 LINE User ID
    const [configs] = await pool.execute<RowDataPacket[]>(
      `SELECT line_user_id FROM smart_schedule_config WHERE enabled = true LIMIT 1`
    );

    if (configs.length === 0 || !configs[0].line_user_id) {
      res.status(400).json({
        error: '請先在 UCB 設定中設定 LINE User ID',
        hint: '前往 UCB 智能排程設定頁面，填寫您的 LINE User ID'
      });
      return;
    }

    const lineUserId = configs[0].line_user_id;

    // 找到對應的使用者並取得 Threads 帳號
    const [users] = await pool.execute<RowDataPacket[]>(
      `SELECT u.id, ta.id as threads_account_id
       FROM users u
       LEFT JOIN threads_accounts ta ON u.id = ta.user_id AND ta.status = 'ACTIVE' AND ta.is_default = 1
       WHERE u.line_user_id = ? AND u.status = 'ACTIVE'
       LIMIT 1`,
      [lineUserId]
    );

    if (users.length === 0) {
      res.status(400).json({
        error: 'LINE User ID 找不到對應的使用者',
        hint: '請確認 LINE User ID 是否正確'
      });
      return;
    }

    const creatorId = users[0].id;
    const threadsAccountId = users[0].threads_account_id;

    // 隨機選擇一個啟用的模板
    const [templates] = await pool.execute<RowDataPacket[]>(
      `SELECT id, name, prompt, preferred_engine FROM content_templates
       WHERE enabled = true
       ORDER BY RAND()
       LIMIT 1`
    );

    if (templates.length === 0) {
      res.status(400).json({
        error: '沒有可用的內容模板',
        hint: '請先建立至少一個啟用的內容模板'
      });
      return;
    }

    const template = templates[0];
    logger.info(`📝 Using template: ${template.name}`);

    // 建立 Post (DRAFT 狀態)
    const post = await PostModel.create({
      status: PostStatus.DRAFT,
      created_by: creatorId,
    });

    logger.info(`✓ Created post: ${post.id}`);

    // Threads 帳號會透過 created_by -> users -> threads_accounts 關聯自動取得
    if (threadsAccountId) {
      logger.info(`✓ User has Threads account: ${threadsAccountId}`);
    } else {
      logger.warn(`⚠ User does not have a default Threads account`);
    }

    // 加入生成佇列
    await queueService.addGenerateJob({
      postId: post.id,
      createdBy: creatorId,
      stylePreset: template.prompt,
      engine: template.preferred_engine || 'GPT5_2',
    });

    logger.info(`✓ Added to generation queue with engine: ${template.preferred_engine || 'GPT5_2'}`);
    logger.info(`📱 LINE notification will be sent to: ${lineUserId}`);

    res.json({
      success: true,
      message: '✅ 測試已啟動！文章生成完成後會發送 LINE 通知給您審核',
      details: {
        postId: post.id,
        templateName: template.name,
        lineUserId: lineUserId,
        engine: template.preferred_engine || 'GPT5_2',
      }
    });
  } catch (error: any) {
    logger.error('Failed to trigger test generation:', error);
    res.status(500).json({ error: '無法啟動測試', message: error.message });
  }
});

/**
 * POST /api/generate/test
 * 用途：測試生成內容（不儲存到資料庫）
 * 請求：{ prompt }
 * 回傳：{ content }
 */
router.post('/generate/test', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const { prompt, engine } = req.body;

    if (!prompt) {
      res.status(400).json({ error: '請提供提示詞' });
      return;
    }

    // 導入 AI 服務實例（已經實例化）
    const aiService = (await import('../services/ai.service')).default;

    // 使用 AI 服務生成內容
    const result = await aiService.generateContent({
      stylePreset: prompt,
      engine: engine || 'GPT5_2', // 預設使用 GPT-5.2
    });

    if (!result || !result.text) {
      res.status(500).json({ error: 'AI 生成內容失敗，請稍後再試' });
      return;
    }

    logger.info(`Test generation successful using ${result.engine}`);

    res.json({
      success: true,
      content: result.text,
      engine: result.engine,
    });
  } catch (error: any) {
    logger.error('Failed to test generate:', error);
    res.status(500).json({ error: '生成失敗', message: error.message });
  }
});

/**
 * GET /api/diagnose
 * 診斷發布流程
 */
router.get('/diagnose', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const { getPool } = await import('../database/connection');
    const pool = getPool();
    const diagnostics: any = {
      timestamp: new Date().toISOString(),
      checks: {},
    };

    // 1. 檢查 Threads 帳號
    const [accounts] = await pool.execute<RowDataPacket[]>(
      `SELECT ta.id, ta.user_id, ta.username, ta.account_id, ta.status, ta.is_default,
              t.expires_at, t.status as token_status
       FROM threads_accounts ta
       LEFT JOIN threads_auth t ON ta.id = t.account_id
       ORDER BY ta.is_default DESC, ta.created_at DESC
       LIMIT 3`
    );

    diagnostics.checks.threadsAccounts = {
      total: accounts.length,
      accounts: accounts.map((acc: any) => ({
        id: acc.id,
        userId: acc.user_id,
        username: acc.username,
        accountId: acc.account_id,
        status: acc.status,
        isDefault: acc.is_default,
        tokenStatus: acc.token_status,
        tokenExpires: acc.expires_at,
        issues: [
          !acc.account_id && '❌ 缺少 account_id',
          !acc.is_default && '⚠️ 不是預設帳號',
          acc.token_status !== 'OK' && '⚠️ Token 狀態異常',
          acc.expires_at && new Date(acc.expires_at) < new Date() && '⚠️ Token 已過期',
        ].filter(Boolean),
      })),
    };

    // 2. 檢查最近的文章
    const [posts] = await pool.execute<RowDataPacket[]>(
      `SELECT p.id, p.status, p.created_at, p.approved_at, p.posted_at,
              p.post_url, p.threads_media_id,
              p.last_error_code, p.last_error_message
       FROM posts p
       ORDER BY p.created_at DESC
       LIMIT 5`
    );

    diagnostics.checks.recentPosts = {
      total: posts.length,
      posts: posts.map((post: any) => ({
        id: post.id,
        status: post.status,
        createdAt: post.created_at,
        approvedAt: post.approved_at,
        postedAt: post.posted_at,
        postUrl: post.post_url,
        threadsMediaId: post.threads_media_id,
        error: post.last_error_code || post.last_error_message ? {
          code: post.last_error_code,
          message: post.last_error_message,
        } : null,
        issues: [
          post.status === 'APPROVED' && !post.posted_at && '⚠️ 已核准但未發布',
          post.status === 'FAILED' && '❌ 發布失敗',
        ].filter(Boolean),
      })),
    };

    // 3. 檢查環境變數
    diagnostics.checks.environment = {
      redisUrl: process.env.REDIS_URL ? '✓ 已設定' : '❌ 未設定',
      mysqlHost: process.env.MYSQL_HOST || 'localhost',
      mysqlDatabase: process.env.MYSQL_DATABASE || 'threads_bot_db',
    };

    // 4. 分析問題
    const defaultAccount = accounts.find((a: any) => a.is_default);
    const approvedNotPosted = posts.filter((p: any) => p.status === 'APPROVED' && !p.posted_at);
    const failed = posts.filter((p: any) => p.status === 'FAILED');

    diagnostics.analysis = {
      hasDefaultAccount: !!defaultAccount,
      defaultAccountHasId: defaultAccount?.account_id ? true : false,
      approvedButNotPostedCount: approvedNotPosted.length,
      failedPostsCount: failed.length,
      recommendations: [],
    };

    if (!defaultAccount) {
      diagnostics.analysis.recommendations.push('需要設定預設 Threads 帳號');
    } else if (!defaultAccount.account_id) {
      diagnostics.analysis.recommendations.push('預設帳號缺少 account_id,需要重新授權或手動更新');
    }

    if (approvedNotPosted.length > 0) {
      diagnostics.analysis.recommendations.push('有已核准但未發布的文章,可能是 Worker 未執行或 Redis 連接問題');
    }

    if (failed.length > 0) {
      diagnostics.analysis.recommendations.push('有發布失敗的文章,請查看錯誤訊息');
    }

    res.json(diagnostics);
  } catch (error: any) {
    logger.error('Diagnostic failed:', error);
    res.status(500).json({ error: '診斷失敗', message: error.message });
  }
});

export default router;
