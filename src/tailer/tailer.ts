import { stripAnsi } from './ansi';

export interface TailerOptions {
  maxLines?: number;
  maxChars?: number;
}

export interface TailSnapshot {
  text: string;
  lines: string[];
  chars: number;
  lastUpdate: number;
}

const DEFAULT_MAX_LINES = 300;
const DEFAULT_MAX_CHARS = 24_000;

export class TerminalTailer {
  private readonly maxLines: number;
  private readonly maxChars: number;
  private buffer = '';
  private lastUpdate = 0;

  constructor(options: TailerOptions = {}) {
    const ml = options.maxLines ?? DEFAULT_MAX_LINES;
    const mc = options.maxChars ?? DEFAULT_MAX_CHARS;
    if (!Number.isFinite(ml) || ml <= 0) {
      throw new RangeError('maxLines must be a positive finite number');
    }
    if (!Number.isFinite(mc) || mc <= 0) {
      throw new RangeError('maxChars must be a positive finite number');
    }
    this.maxLines = Math.floor(ml);
    this.maxChars = Math.floor(mc);
  }

  push(chunk: string | Buffer): void {
    if (chunk == null) return;
    const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    if (text.length === 0) return;
    const cleaned = stripAnsi(text);
    if (cleaned.length === 0) return;
    this.buffer += cleaned;
    this.trim();
    this.lastUpdate = Date.now();
  }

  snapshot(): TailSnapshot {
    const lines = this.buffer.length === 0 ? [] : this.buffer.split('\n');
    return {
      text: this.buffer,
      lines,
      chars: this.buffer.length,
      lastUpdate: this.lastUpdate
    };
  }

  tailLines(n: number): string[] {
    if (!Number.isFinite(n) || n <= 0) return [];
    const lines = this.buffer.split('\n');
    return lines.slice(Math.max(0, lines.length - Math.floor(n)));
  }

  clear(): void {
    this.buffer = '';
    this.lastUpdate = 0;
  }

  private trim(): void {
    if (this.buffer.length > this.maxChars) {
      this.buffer = this.buffer.slice(this.buffer.length - this.maxChars);
    }
    // Count newlines. If the buffer has too many lines, drop from the front.
    let newlineCount = 0;
    for (let i = 0; i < this.buffer.length; i++) {
      if (this.buffer.charCodeAt(i) === 10) newlineCount += 1;
    }
    if (newlineCount <= this.maxLines) return;
    const toDrop = newlineCount - this.maxLines;
    let idx = 0;
    let dropped = 0;
    while (dropped < toDrop && idx < this.buffer.length) {
      if (this.buffer.charCodeAt(idx) === 10) dropped += 1;
      idx += 1;
    }
    this.buffer = this.buffer.slice(idx);
  }
}
