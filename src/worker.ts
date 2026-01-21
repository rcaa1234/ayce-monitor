import { validateConfig } from './config';
import logger from './utils/logger';
import { createDatabasePool, closeDatabasePool } from './database/connection';
import { startSchedulers, stopSchedulers } from './cron/scheduler';
import generateWorker from './workers/generate.worker';
import publishWorker from './workers/publish.worker';
import tokenRefreshWorker from './workers/token-refresh.worker';

async function startWorkers() {
  try {
    logger.info('Starting workers...');

    // Validate config
    logger.info('Validating configuration...');
    validateConfig();
    logger.info('✓ Configuration validated');

    // Connect to database
    logger.info('Connecting to database...');
    await createDatabasePool();
    logger.info('✓ Database connected');

    // Start cron schedulers (including auto-scheduling)
    logger.info('Starting cron schedulers...');
    await startSchedulers();
    logger.info('✓ All cron schedulers started successfully');

    logger.info('✓ Generate worker started');
    logger.info('✓ Publish worker started');
    logger.info('✓ Token refresh worker started');
    logger.info('Workers are running and waiting for jobs...');
  } catch (error) {
    logger.error('Failed to start workers:', error);
    logger.error('Error stack:', error instanceof Error ? error.stack : 'No stack trace');
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down workers...');
  stopSchedulers();
  await generateWorker.close();
  await publishWorker.close();
  await tokenRefreshWorker.close();
  await closeDatabasePool();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down workers...');
  stopSchedulers();
  await generateWorker.close();
  await publishWorker.close();
  await tokenRefreshWorker.close();
  await closeDatabasePool();
  process.exit(0);
});

// Start workers
startWorkers();

