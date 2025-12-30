import { Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import config from '../config';
import logger from '../utils/logger';
import { QUEUE_NAMES, TokenRefreshJobData } from '../services/queue.service';
import threadsService from '../services/threads.service';
import { getPool } from '../database/connection';
import { RowDataPacket } from 'mysql2';
import { decrypt } from '../utils/encryption';
import { AuditModel } from '../models/audit.model';

const connection = new Redis(config.redis.url, {
  maxRetriesPerRequest: null,
});

export const tokenRefreshWorker = new Worker(
  QUEUE_NAMES.TOKEN_REFRESH,
  async (job: Job<TokenRefreshJobData>) => {
    const { accountId } = job.data;

    logger.info(`Processing token refresh job ${job.id} for account ${accountId}`);

    try {
      const pool = getPool();

      // Get current token
      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT access_token_encrypted, expires_at, status
         FROM threads_auth
         WHERE account_id = ?`,
        [accountId]
      );

      if (rows.length === 0) {
        throw new Error('Account not found');
      }

      const currentTokenEncrypted = rows[0].access_token_encrypted;
      const currentToken = decrypt(currentTokenEncrypted);

      await job.updateProgress(30);

      // Refresh token
      const refreshed = await threadsService.refreshToken(currentToken);

      await job.updateProgress(70);

      // Update token in database
      await threadsService.updateToken(
        accountId,
        refreshed.access_token,
        refreshed.expires_in
      );

      await job.updateProgress(90);

      // Log audit
      await AuditModel.log({
        action: 'token_refreshed',
        target_type: 'threads_account',
        target_id: accountId,
        metadata: {
          expires_in: refreshed.expires_in,
        },
      });

      await job.updateProgress(100);

      logger.info(`Token refresh job ${job.id} completed successfully`);

      return {
        success: true,
        accountId,
        expiresIn: refreshed.expires_in,
      };
    } catch (error: any) {
      logger.error(`Token refresh job ${job.id} failed:`, error);

      // Mark token status based on error
      if (error.message.includes('invalid') || error.message.includes('expired')) {
        await threadsService.markTokenStatus(accountId, 'ACTION_REQUIRED');

        // TODO: Send notification to admin
        logger.error(`Token for account ${accountId} requires manual action`);
      }

      throw error;
    }
  },
  {
    connection,
    concurrency: 1,
  }
);

tokenRefreshWorker.on('completed', (job) => {
  logger.info(`Job ${job.id} completed`);
});

tokenRefreshWorker.on('failed', (job, err) => {
  logger.error(`Job ${job?.id} failed:`, err);
});

export default tokenRefreshWorker;
