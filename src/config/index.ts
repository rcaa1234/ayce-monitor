import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

// Load environment-specific .env file
// Priority: .env.local > .env
// IMPORTANT: override=true to ensure .env file values override system environment variables
const possibleEnvFiles = ['.env.local', '.env'];
let loadedEnvFile = '.env';

for (const envFile of possibleEnvFiles) {
  const envPath = path.resolve(process.cwd(), envFile);
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath, override: true });
    loadedEnvFile = envFile;
    break;
  }
}

console.log(`Loaded environment from: ${loadedEnvFile}`);

interface Config {
  app: {
    env: string;
    baseUrl: string;
    port: number;
  };
  database: {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
  };
  redis: {
    url: string;
  };
  ai: {
    openai: {
      apiKey: string;
    };
    gemini: {
      apiKey: string;
    };
  };
  line: {
    channelAccessToken: string;
    channelSecret: string;
  };
  jwt: {
    secret: string;
    expiresIn: string;
  };
  encryption: {
    key: string;
  };
  similarity: {
    threshold: number;
    compareCount: number;
    maxRetries: number;
  };
  threads: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    apiBaseUrl: string;
    tokenRefreshThreshold: number; // hours before expiry
  };
}

const config: Config = {
  app: {
    env: process.env.APP_ENV || 'local',
    baseUrl: process.env.APP_BASE_URL || 'http://localhost:3000',
    port: parseInt(process.env.APP_PORT || process.env.PORT || '3000', 10),
  },
  database: {
    host: process.env.MYSQL_HOST || 'localhost',
    port: parseInt(process.env.MYSQL_PORT || '3306', 10),
    user: process.env.MYSQL_USER || process.env.MYSQL_USERNAME || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'threads_posting',
  },
  redis: {
    // Support Zeabur's auto-generated env vars
    url: process.env.REDIS_URL || process.env.REDIS_CONNECTION_STRING || process.env.REDIS_URI || 'redis://localhost:6379',
  },
  ai: {
    openai: {
      apiKey: process.env.OPENAI_API_KEY || '',
    },
    gemini: {
      apiKey: process.env.GEMINI_API_KEY || '',
    },
  },
  line: {
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || '',
    channelSecret: process.env.LINE_CHANNEL_SECRET || '',
  },
  jwt: {
    secret: process.env.JWT_SECRET || 'your_jwt_secret_key',
    expiresIn: '7d',
  },
  encryption: {
    key: process.env.ENCRYPTION_KEY || '',
  },
  similarity: {
    threshold: 0.86,
    compareCount: 60,
    maxRetries: 3,
  },
  threads: {
    clientId: process.env.THREADS_CLIENT_ID || '',
    clientSecret: process.env.THREADS_CLIENT_SECRET || '',
    redirectUri: process.env.THREADS_REDIRECT_URI || 'http://localhost:3000/api/threads/oauth/callback',
    apiBaseUrl: 'https://graph.threads.net',
    tokenRefreshThreshold: 24, // Refresh if less than 24 hours since last refresh
  },
};

// Validation
export function validateConfig(): void {
  const required = [
    { key: 'MYSQL_HOST', value: config.database.host },
    { key: 'MYSQL_DATABASE', value: config.database.database },
    { key: 'REDIS_URL', value: config.redis.url },
  ];

  const missing = required.filter(({ value }) => !value).map(({ key }) => key);

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  // Warn about optional but important configs
  const warnings: string[] = [];

  if (!config.ai.openai.apiKey) warnings.push('OPENAI_API_KEY not set');
  if (!config.ai.gemini.apiKey) warnings.push('GEMINI_API_KEY not set');
  if (!config.line.channelAccessToken) warnings.push('LINE_CHANNEL_ACCESS_TOKEN not set');
  if (!config.encryption.key || config.encryption.key.length < 32) {
    warnings.push('ENCRYPTION_KEY not set or too short (need 32+ chars)');
  }

  if (warnings.length > 0) {
    console.warn('Configuration warnings:', warnings.join(', '));
  }
}

export default config;
