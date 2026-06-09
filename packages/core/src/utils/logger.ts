/**
 * Minimal Logger Utility
 * Simple, clean logging without bloat
 */

import chalk from 'chalk';

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3
}

class Logger {
  private level: LogLevel;

  constructor() {
    const debugMode = process.env.DEBUG === 'true';
    this.level = debugMode ? LogLevel.DEBUG : LogLevel.INFO;
  }

  debug(...args: any[]): void {
    if (this.level <= LogLevel.DEBUG) {
      console.log(chalk.gray('[DEBUG]'), ...args);
    }
  }

  info(...args: any[]): void {
    if (this.level <= LogLevel.INFO) {
      console.log(chalk.blue('[INFO]'), ...args);
    }
  }

  warn(...args: any[]): void {
    if (this.level <= LogLevel.WARN) {
      console.log(chalk.yellow('[WARN]'), ...args);
    }
  }

  error(...args: any[]): void {
    if (this.level <= LogLevel.ERROR) {
      console.log(chalk.red('[ERROR]'), ...args);
    }
  }

  success(...args: any[]): void {
    console.log(chalk.green('✓'), ...args);
  }
}

export const logger = new Logger();