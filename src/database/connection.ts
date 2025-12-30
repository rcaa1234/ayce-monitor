import mysql from 'mysql2/promise';
import config from '../config';

let pool: mysql.Pool | null = null;

export async function createDatabasePool(): Promise<mysql.Pool> {
  if (pool) {
    return pool;
  }

  pool = mysql.createPool({
    host: config.database.host,
    port: config.database.port,
    user: config.database.user,
    password: config.database.password,
    database: config.database.database,
    charset: 'utf8mb4',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
  });

  // Test connection
  try {
    const connection = await pool.getConnection();
    console.log('✓ MySQL database connected successfully');
    connection.release();
  } catch (error) {
    console.error('✗ Failed to connect to MySQL database:', error);
    throw error;
  }

  return pool;
}

export function getPool(): mysql.Pool {
  if (!pool) {
    throw new Error('Database pool not initialized. Call createDatabasePool() first.');
  }
  return pool;
}

export async function closeDatabasePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    console.log('✓ MySQL database connection closed');
  }
}

export default {
  createDatabasePool,
  getPool,
  closeDatabasePool,
};
