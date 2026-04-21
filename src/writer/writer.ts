import type { LoggerLike } from '../types';

export interface WritableTarget {
  write(data: string): boolean | void;
}

export interface TerminalWriterOptions {
  chunkSize?: number;
  chunkDelayMs?: number;
  yStreakLimit?: number;
  cooldownMs?: number;
  logger?: LoggerLike;
}

/**
 * Inject approvals/replies into a PTY-like target with three safety nets:
 *  - in-flight flag prevents concurrent writes for a single session;
 *  - cooldown avoids rapid-fire responses when output arrives in bursts;
 *  - Y-streak limit disables auto-approve after repeated confirmations.
 *
 * Matches the guardrails documented in the Manager briefing
 * (Y_STREAK_LIMIT = 5, RESPONSE_COOLDOWN_MS ~8s).
 */
export class TerminalWriter {
  private readonly chunkSize: number;
  private readonly chunkDelayMs: number;
  private readonly yStreakLimit: number;
  private readonly cooldownMs: number;
  private readonly logger?: LoggerLike;

  private writing = false;
  private lastWriteAt = 0;
  private yStreak = 0;
  private disabled = false;
  private disabledReason = '';

  constructor(private readonly target: WritableTarget, options: TerminalWriterOptions = {}) {
    this.chunkSize = options.chunkSize ?? 1024;
    this.chunkDelayMs = options.chunkDelayMs ?? 5;
    this.yStreakLimit = options.yStreakLimit ?? 5;
    this.cooldownMs = options.cooldownMs ?? 8_000;
    this.logger = options.logger;
    if (this.chunkSize <= 0) throw new RangeError('chunkSize must be > 0');
    if (this.chunkDelayMs < 0) throw new RangeError('chunkDelayMs must be >= 0');
    if (this.yStreakLimit <= 0) throw new RangeError('yStreakLimit must be > 0');
    if (this.cooldownMs < 0) throw new RangeError('cooldownMs must be >= 0');
  }

  isDisabled(): boolean {
    return this.disabled;
  }

  getDisabledReason(): string {
    return this.disabledReason;
  }

  reset(): void {
    this.writing = false;
    this.yStreak = 0;
    this.disabled = false;
    this.disabledReason = '';
  }

  async writeApproval(
    bytes: string,
    opts: { bumpStreak?: boolean } = {}
  ): Promise<{ ok: boolean; reason?: string }> {
    if (this.disabled) return { ok: false, reason: `writer disabled: ${this.disabledReason}` };
    if (this.writing) return { ok: false, reason: 'writer busy' };
    const now = Date.now();
    if (now - this.lastWriteAt < this.cooldownMs && this.lastWriteAt !== 0) {
      return { ok: false, reason: 'within cooldown window' };
    }
    if (opts.bumpStreak !== false) {
      this.yStreak += 1;
      if (this.yStreak > this.yStreakLimit) {
        this.disabled = true;
        this.disabledReason = `y-streak limit (${this.yStreakLimit}) exceeded`;
        this.logger?.warn('writer.disabled', { reason: this.disabledReason });
        return { ok: false, reason: this.disabledReason };
      }
    } else {
      this.yStreak = 0;
    }
    return this.doWrite(bytes);
  }

  async writeReply(text: string): Promise<{ ok: boolean; reason?: string }> {
    if (this.disabled) return { ok: false, reason: `writer disabled: ${this.disabledReason}` };
    if (this.writing) return { ok: false, reason: 'writer busy' };
    const now = Date.now();
    if (now - this.lastWriteAt < this.cooldownMs && this.lastWriteAt !== 0) {
      return { ok: false, reason: 'within cooldown window' };
    }
    this.yStreak = 0;
    return this.doWrite(text);
  }

  notifyRichOutput(): void {
    // Any non-trivial output from the agent resets the streak: it proves we
    // are not stuck in a confirmation loop.
    this.yStreak = 0;
  }

  private async doWrite(data: string): Promise<{ ok: boolean; reason?: string }> {
    if (!data) return { ok: false, reason: 'empty payload' };
    this.writing = true;
    try {
      let offset = 0;
      while (offset < data.length) {
        const end = Math.min(data.length, offset + this.chunkSize);
        const chunk = data.slice(offset, end);
        this.target.write(chunk);
        offset = end;
        if (offset < data.length && this.chunkDelayMs > 0) {
          await delay(this.chunkDelayMs);
        }
      }
      this.lastWriteAt = Date.now();
      this.logger?.info('writer.wrote', { bytes: data.length });
      return { ok: true };
    } catch (err) {
      this.logger?.error('writer.error', { error: (err as Error)?.message });
      return { ok: false, reason: (err as Error)?.message ?? 'write failed' };
    } finally {
      this.writing = false;
    }
  }
}

function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}
