import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import config from '../config';

const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

const level = () => {
  const env = config.app.env;
  const isDevelopment = env === 'local';
  return isDevelopment ? 'debug' : 'info';
};

const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'white',
};

winston.addColors(colors);

// Console format: colorized for development
const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.colorize({ all: true }),
  winston.format.printf(
    (info) => `${info.timestamp} ${info.level}: ${info.message}`
  )
);

// File format: plain text without ANSI codes
const fileFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.uncolorize(),
  winston.format.printf(
    (info) => `${info.timestamp} ${info.level}: ${info.message}`
  )
);

// JSON format for production (ELK/Loki compatible)
const jsonFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.uncolorize(),
  winston.format.json()
);

const isProduction = config.app.env !== 'local';

const transports: winston.transport[] = [
  new winston.transports.Console({
    format: isProduction ? jsonFormat : consoleFormat,
  }),
  new DailyRotateFile({
    filename: 'logs/error-%DATE%.log',
    datePattern: 'YYYY-MM-DD',
    level: 'error',
    maxFiles: `${config.monitoring.logRotationDays}d`,
    maxSize: `${config.monitoring.logMaxSizeMb}m`,
    zippedArchive: true,
    format: isProduction ? jsonFormat : fileFormat,
  }),
  new DailyRotateFile({
    filename: 'logs/all-%DATE%.log',
    datePattern: 'YYYY-MM-DD',
    maxFiles: `${config.monitoring.logRotationDays}d`,
    maxSize: `${config.monitoring.logMaxSizeMb}m`,
    zippedArchive: true,
    format: isProduction ? jsonFormat : fileFormat,
  }),
];

const logger = winston.createLogger({
  level: level(),
  levels,
  transports,
});

export default logger;
