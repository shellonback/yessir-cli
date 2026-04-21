import * as fs from 'fs';
import * as path from 'path';
import type { LoggerLike } from '../types';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface LoggerOptions {
  file?: string;
  level?: LogLevel;
  echoStderr?: boolean;
}

export class FileLogger implements LoggerLike {
  private readonly threshold: number;
  private readonly file: string | null;
  private readonly echoStderr: boolean;

  constructor(options: LoggerOptions = {}) {
    this.threshold = LEVEL_RANK[options.level ?? 'info'];
    this.file = options.file ?? null;
    this.echoStderr = options.echoStderr ?? false;
    if (this.file) {
      try {
        fs.mkdirSync(path.dirname(this.file), { recursive: true });
      } catch {
        // Swallow: we will surface the error on write.
      }
    }
  }

  debug(event: string, data?: Record<string, unknown>): void {
    this.write('debug', event, data);
  }
  info(event: string, data?: Record<string, unknown>): void {
    this.write('info', event, data);
  }
  warn(event: string, data?: Record<string, unknown>): void {
    this.write('warn', event, data);
  }
  error(event: string, data?: Record<string, unknown>): void {
    this.write('error', event, data);
  }

  private write(level: LogLevel, event: string, data?: Record<string, unknown>): void {
    if (LEVEL_RANK[level] < this.threshold) return;
    const entry = {
      ts: new Date().toISOString(),
      level,
      event,
      ...(data ?? {})
    };
    const line = safeStringify(entry) + '\n';
    if (this.file) {
      try {
        fs.appendFileSync(this.file, line);
      } catch (err) {
        if (this.echoStderr) {
          process.stderr.write(`[yessir] log append failed: ${(err as Error).message}\n`);
        }
      }
    }
    if (this.echoStderr) {
      process.stderr.write(line);
    }
  }
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
  } catch {
    return JSON.stringify({ error: 'failed to stringify log entry' });
  }
}

export class NullLogger implements LoggerLike {
  debug(): void {}
  info(): void {}
  warn(): void {}
  error(): void {}
}
