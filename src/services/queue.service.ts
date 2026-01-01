import { Queue, Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import config from '../config';
import logger from '../utils/logger';
import { JobType } from '../types';

// Parse Redis URL and create connection with proper options
const redisUrl = config.redis.url;
logger.info(`Connecting to Redis: ${redisUrl.replace(/:[^:@]+@/, ':****@')}`);

// Determine if we need TLS (Zeabur and most cloud providers use rediss://)
const isTLS = redisUrl.startsWith('rediss://');

const connection = new Redis(redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  // Remove lazyConnect to avoid timing issues
  retryStrategy: (times) => {
    if (times > 20) {
      logger.error(`Redis retry attempts exceeded: ${times}`);
      return null; // Stop retrying
    }
    const delay = Math.min(times * 500, 5000);
    logger.warn(`Redis retry attempt ${times}, delay: ${delay}ms`);
    return delay;
  },
  reconnectOnError: (err) => {
    const targetErrors = ['READONLY', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE'];
    if (targetErrors.some(e => err.message.includes(e))) {
      logger.warn(`Redis reconnecting due to: ${err.message}`);
      return true; // Reconnect
    }
    return false;
  },
  // Add connection timeout
  connectTimeout: 30000,
  // Add command timeout
  commandTimeout: 5000,
  // Keep alive settings
  keepAlive: 30000,
  // TLS settings for secure connections (Zeabur)
  ...(isTLS && {
    tls: {
      rejectUnauthorized: false, // Some cloud providers use self-signed certs
    },
  }),
  // Disable auto pipelining to reduce connection issues
  enableAutoPipelining: false,
  // Family preference (IPv4 first)
  family: 4,
});

// Connection event handlers
connection.on('error', (err) => {
  // Don't log every single error to avoid log spam
  if (!err.message.includes('ECONNRESET')) {
    logger.error(`Redis connection error: ${err.message}`);
  }
});

connection.on('connect', () => {
  logger.info('✓ Redis connected successfully');
});

connection.on('ready', () => {
  logger.info('✓ Redis ready to accept commands');
});

connection.on('close', () => {
  logger.warn('Redis connection closed');
});

connection.on('reconnecting', () => {
  logger.info('Redis reconnecting...');
});

// Define queue names
export const QUEUE_NAMES = {
  GENERATE: 'content-generation',
  PUBLISH: 'post-publish',
  TOKEN_REFRESH: 'token-refresh',
} as const;

// Create queues
export const generateQueue = new Queue(QUEUE_NAMES.GENERATE, { connection });
export const publishQueue = new Queue(QUEUE_NAMES.PUBLISH, { connection });
export const tokenRefreshQueue = new Queue(QUEUE_NAMES.TOKEN_REFRESH, { connection });

export interface GenerateJobData {
  postId: string;
  stylePreset?: string;
  topic?: string;
  keywords?: string[];
  createdBy: string;
  engine?: string;
}

export interface PublishJobData {
  postId: string;
  revisionId: string;
  accountId?: string;
  threads_account_id?: string;
  scheduledFor?: Date;
}

export interface TokenRefreshJobData {
  accountId: string;
}

class QueueService {
  /**
   * Add a content generation job
   */
  async addGenerateJob(data: GenerateJobData): Promise<Job> {
    logger.info(`Adding generate job for post ${data.postId}`);

    return await generateQueue.add('generate-content', data, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 5000,
      },
      removeOnComplete: {
        count: 100,
      },
      removeOnFail: {
        count: 500,
      },
    });
  }

  /**
   * Add a publish job
   */
  async addPublishJob(data: PublishJobData): Promise<Job> {
    logger.info(`Adding publish job for post ${data.postId}`);

    return await publishQueue.add('publish-post', data, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 10000,
      },
      removeOnComplete: {
        count: 100,
      },
      removeOnFail: {
        count: 500,
      },
    });
  }

  /**
   * Add a token refresh job
   */
  async addTokenRefreshJob(data: TokenRefreshJobData): Promise<Job> {
    logger.info(`Adding token refresh job for account ${data.accountId}`);

    return await tokenRefreshQueue.add('refresh-token', data, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 30000,
      },
      removeOnComplete: {
        count: 50,
      },
      removeOnFail: {
        count: 100,
      },
    });
  }

  /**
   * Get job status
   */
  async getJobStatus(jobId: string, queueName: string): Promise<any> {
    let queue: Queue;

    switch (queueName) {
      case QUEUE_NAMES.GENERATE:
        queue = generateQueue;
        break;
      case QUEUE_NAMES.PUBLISH:
        queue = publishQueue;
        break;
      case QUEUE_NAMES.TOKEN_REFRESH:
        queue = tokenRefreshQueue;
        break;
      default:
        throw new Error(`Unknown queue: ${queueName}`);
    }

    const job = await queue.getJob(jobId);

    if (!job) {
      return null;
    }

    return {
      id: job.id,
      name: job.name,
      data: job.data,
      progress: await job.progress,
      state: await job.getState(),
      attemptsMade: job.attemptsMade,
      failedReason: job.failedReason,
      finishedOn: job.finishedOn,
      processedOn: job.processedOn,
    };
  }

  /**
   * Close all connections
   */
  async close(): Promise<void> {
    await generateQueue.close();
    await publishQueue.close();
    await tokenRefreshQueue.close();
    await connection.quit();
    logger.info('Queue connections closed');
  }
}

export default new QueueService();
