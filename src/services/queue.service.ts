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

// Critical: Use simpler, more stable Redis configuration for Zeabur
// The key issue is that Zeabur Redis has connection limits and stability issues
const connectionOptions: any = {
  // BullMQ requirements
  maxRetriesPerRequest: null,
  enableReadyCheck: false,

  // Simplified retry strategy - fewer retries, longer delays
  retryStrategy: (times: number) => {
    if (times > 5) {
      logger.error(`Redis max retries (${times}) exceeded`);
      return null;
    }
    const delay = times * 2000; // 2s, 4s, 6s, 8s, 10s
    logger.warn(`Redis retry ${times}/5, delay: ${delay}ms`);
    return delay;
  },

  // Disable reconnect on error to prevent connection storms
  reconnectOnError: () => false,

  // Longer timeouts for stability
  connectTimeout: 20000,

  // Enable offline queue to buffer commands
  enableOfflineQueue: true,

  // TLS support for Zeabur
  ...(isTLS && {
    tls: {
      rejectUnauthorized: false,
    },
  }),
};

// Log connection attempt
logger.info('Initializing Redis connection for BullMQ...');

// Define queue names
export const QUEUE_NAMES = {
  GENERATE: 'content-generation',
  PUBLISH: 'post-publish',
  TOKEN_REFRESH: 'token-refresh',
} as const;

// Create queues - BullMQ will manage connections internally
// Pass connection options, not a Redis instance
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
const testConnection = new Redis(redisUrl, {
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
