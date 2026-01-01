import { Queue, Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import config from '../config';
import logger from '../utils/logger';
import { JobType } from '../types';

// Parse Redis URL
const redisUrl = config.redis.url;
logger.info(`Connecting to Redis: ${redisUrl.replace(/:[^:@]+@/, ':****@')}`);

// Determine if we need TLS (Zeabur and most cloud providers use rediss://)
const isTLS = redisUrl.startsWith('rediss://');

// Parse Redis URL components for ioredis
const url = new URL(redisUrl);

// Extract password from URL (handle both username:password and just password)
let password: string | undefined;
if (url.password) {
  password = decodeURIComponent(url.password);
} else if (url.username) {
  // Some Redis URLs put password in username field
  password = decodeURIComponent(url.username);
}

// Critical: BullMQ needs the full connection configuration
// MUST include host, port, and all other settings
const connectionOptions: any = {
  host: url.hostname,
  port: parseInt(url.port || (isTLS ? '6380' : '6379'), 10),

  // Add password if present
  ...(password && { password }),

  // BullMQ requirements
  maxRetriesPerRequest: null,
  enableReadyCheck: false,

  // More aggressive retry for cloud environments
  retryStrategy: (times: number) => {
    if (times > 10) {
      logger.error(`Redis max retries (${times}) exceeded`);
      return null;
    }
    // Exponential backoff: 1s, 2s, 4s, 8s, max 10s
    const delay = Math.min(Math.pow(2, times) * 1000, 10000);
    logger.warn(`Redis retry ${times}/10, delay: ${delay}ms`);
    return delay;
  },

  // Allow reconnect on transient errors
  reconnectOnError: (err: Error) => {
    const reconnectErrors = ['READONLY', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'ENOTFOUND'];
    if (reconnectErrors.some(e => err.message.includes(e))) {
      logger.warn(`Reconnecting due to: ${err.message}`);
      return true;
    }
    return false;
  },

  // Longer timeouts for cloud
  connectTimeout: 30000,
  commandTimeout: 10000,

  // Enable offline queue
  enableOfflineQueue: true,

  // Don't fail on first connect error
  autoResubscribe: true,
  autoResendUnfulfilledCommands: true,

  // TLS support for Zeabur (rediss://)
  ...(isTLS && {
    tls: {
      rejectUnauthorized: false,
      // Additional TLS options for compatibility
      minVersion: 'TLSv1.2',
    },
  }),
};

logger.info(`Initializing Redis for BullMQ: ${url.hostname}:${connectionOptions.port} (TLS: ${isTLS}, Auth: ${!!password})`);

// Define queue names
export const QUEUE_NAMES = {
  GENERATE: 'content-generation',
  PUBLISH: 'post-publish',
  TOKEN_REFRESH: 'token-refresh',
} as const;

// Create queues with proper connection config
export const generateQueue = new Queue(QUEUE_NAMES.GENERATE, {
  connection: connectionOptions,
});

export const publishQueue = new Queue(QUEUE_NAMES.PUBLISH, {
  connection: connectionOptions,
});

export const tokenRefreshQueue = new Queue(QUEUE_NAMES.TOKEN_REFRESH, {
  connection: connectionOptions,
});

// Create a test connection to verify Redis is accessible
const testConnection = new Redis({
  ...connectionOptions,
  lazyConnect: true,
});

testConnection.connect()
  .then(() => {
    logger.info('✓ Redis test connection successful');
    return testConnection.ping();
  })
  .then(() => {
    logger.info('✓ Redis PING successful');
    return testConnection.quit();
  })
  .catch((err) => {
    logger.error(`Redis test connection failed: ${err.message}`);
  });

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
    logger.info('Queue connections closed');
  }
}

export default new QueueService();
