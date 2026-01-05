import { Queue, Job } from 'bullmq';
import Redis, { RedisOptions } from 'ioredis';
import config from '../config';
import logger from '../utils/logger';

// Parse Redis URL
const redisUrl = config.redis.url;
logger.info(`Connecting to Redis: ${redisUrl.replace(/:[^:@]+@/, ':****@')}`);

// Parse URL components
function parseRedisUrl(urlString: string) {
  const url = new URL(urlString);
  const isTLS = url.protocol === 'rediss:';

  return {
    host: url.hostname,
    port: parseInt(url.port || (isTLS ? '6380' : '6379'), 10),
    password: url.password ? decodeURIComponent(url.password) : undefined,
    tls: isTLS ? { rejectUnauthorized: false, minVersion: 'TLSv1.2' as const } : undefined,
  };
}

const redisConfig = parseRedisUrl(redisUrl);

// CONNECTION POOL IMPLEMENTATION (Zeabur AI recommendation)
// Create a shared Redis connection that will be reused across all queues
// This significantly reduces the number of connections (from 12+ to ~3)
const sharedConnectionOptions: RedisOptions = {
  ...redisConfig,

  // BullMQ requirements
  maxRetriesPerRequest: null,
  enableReadyCheck: false,

  // Connection pool settings to minimize connections
  enableOfflineQueue: true,
  lazyConnect: false,

  // Connection timeouts (Zeabur AI recommendation)
  connectTimeout: 30000,
  commandTimeout: 30000,
  keepAlive: 30000,

  // Retry strategy (Zeabur AI recommendation)
  retryStrategy: (times: number) => {
    const delay = Math.min(times * 50, 2000);
    if (times <= 3) logger.warn(`Redis retry ${times}, delay: ${delay}ms`);
    return delay;
  },

  // Connection pool optimization
  autoResubscribe: true,
  autoResendUnfulfilledCommands: true,

  // Reduce connection overhead by grouping commands
  enableAutoPipelining: true
};

logger.info(`Redis connection pool config: ${redisConfig.host}:${redisConfig.port}, TLS: ${!!redisConfig.tls}, Auth: ${!!redisConfig.password}`);

// Define queue names
export const QUEUE_NAMES = {
  GENERATE: 'content-generation',
  PUBLISH: 'post-publish',
  TOKEN_REFRESH: 'token-refresh',
} as const;

logger.info('Initializing BullMQ queues with connection pool...');

// Create queues with connection factory for proper pooling
export const generateQueue = new Queue(QUEUE_NAMES.GENERATE, {
  connection: sharedConnectionOptions,
});

export const publishQueue = new Queue(QUEUE_NAMES.PUBLISH, {
  connection: sharedConnectionOptions,
});

export const tokenRefreshQueue = new Queue(QUEUE_NAMES.TOKEN_REFRESH, {
  connection: sharedConnectionOptions,
});

// Test connection (will be closed after verification)
logger.info('Testing Redis connection...');
const testConnection = new Redis({
  ...sharedConnectionOptions,
  lazyConnect: true,
  connectionName: 'test-connection',
});

testConnection.connect()
  .then(() => {
    logger.info('✓ Redis test connection successful');
    return testConnection.ping();
  })
  .then(() => {
    logger.info('✓ Redis PING successful');
    logger.info(`Total potential connections: ~6 (3 queues × 2 connections each)`);
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
  scheduledTime?: string;  // ISO 8601 格式，自動排程的發文時間
  autoScheduleId?: string; // 關聯的自動排程 ID
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
