import express, { Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import path from 'path';
import config, { validateConfig } from './config';
import logger from './utils/logger';
import { createDatabasePool, closeDatabasePool } from './database/connection';
import routes from './routes';
import { startSchedulers, stopSchedulers } from './cron/scheduler';
import generateWorker from './workers/generate.worker';
import publishWorker from './workers/publish.worker';
import tokenRefreshWorker from './workers/token-refresh.worker';

const app: Application = express();

// Middleware
app.use(helmet({
  contentSecurityPolicy: false, // Disable CSP for frontend
}));
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan('combined'));

// Serve static files (frontend)
app.use(express.static(path.join(__dirname, '../public')));

// API Routes
app.use('/api', routes);

// Serve frontend for all non-API routes
app.get('*', (_req, res) => {
  if (!_req.path.startsWith('/api')) {
    res.sendFile(path.join(__dirname, '../public/index.html'));
  }
});

// Error handling
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: config.app.env === 'local' ? err.message : undefined,
  });
});

// Initialize server
async function start() {
  try {
    logger.info('🚀 Starting Threads Auto-Posting System...');

    // Validate config
    logger.info('Validating configuration...');
    validateConfig();
    logger.info('✓ Configuration validated');

    // Connect to database
    logger.info('Connecting to database...');
    await createDatabasePool();
    logger.info('✓ Database connected');

    // Start cron schedulers
    logger.info('Starting cron schedulers...');
    await startSchedulers();
    logger.info('✓ All cron schedulers started successfully');

    // Workers are imported but run automatically via BullMQ
    logger.info('✓ Generate worker registered');
    logger.info('✓ Publish worker registered');
    logger.info('✓ Token refresh worker registered');

    // Start server
    const port = config.app.port;
    const host = '0.0.0.0'; // Listen on all network interfaces for container deployment
    app.listen(port, host, () => {
      logger.info(`🚀 API Server running on ${host}:${port}`);
      logger.info(`Environment: ${config.app.env}`);
      logger.info(`Base URL: ${config.app.baseUrl}`);
      logger.info('✅ System fully initialized and ready');
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    logger.error('Error stack:', error instanceof Error ? error.stack : 'No stack trace');
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully...');
  stopSchedulers();
  await generateWorker.close();
  await publishWorker.close();
  await tokenRefreshWorker.close();
  await closeDatabasePool();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down gracefully...');
  stopSchedulers();
  await generateWorker.close();
  await publishWorker.close();
  await tokenRefreshWorker.close();
  await closeDatabasePool();
  process.exit(0);
});

// Start if run directly
if (require.main === module) {
  start();
}

export default app;
