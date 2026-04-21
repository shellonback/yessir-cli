import * as path from 'path';
import { getAdapter } from '../detector';
import { PolicyEngine } from '../policy/engine';
import { findPolicyFile, loadPolicy, DEFAULT_POLICY } from '../policy/loader';
import {
  defaultProviderCommand,
  ProviderBinaryNotFoundError,
  PtyUnavailableError,
  spawnPty
} from '../pty/wrapper';
import { TerminalTailer } from '../tailer/tailer';
import { TerminalWriter } from '../writer/writer';
import { FileLogger } from '../util/logger';
import { NoopReviewer, redactSecrets, summarizePolicy, toEngineDecision } from '../ai/reviewer';
import type { AiReviewer, ReviewerInput } from '../ai/reviewer';
import type { Mode, Provider } from '../types';

const LOG_RELATIVE_PATH = path.join('.yessir', 'yessir.log');
const DEFAULT_IDLE_MS = 3_000;
const POLL_INTERVAL_MS = 400;

export interface RunOptions {
  cwd: string;
  provider: Provider;
  mode?: Mode;
  dryRun?: boolean;
  noAi?: boolean;
  command?: string;
  args?: readonly string[];
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
  reviewer?: AiReviewer;
  stdin?: NodeJS.ReadStream;
  stdout?: NodeJS.WriteStream;
  onExit?: (code: number | null) => void;
}

export async function runWrap(opts: RunOptions): Promise<number> {
  const cwd = path.resolve(opts.cwd);
  const logger = new FileLogger({
    file: path.join(cwd, LOG_RELATIVE_PATH),
    level: opts.logLevel ?? 'info'
  });

  const policyPath = findPolicyFile(cwd);
  const policy = policyPath ? loadPolicy(policyPath) : DEFAULT_POLICY;
  if (!policyPath) {
    logger.warn('run.policy_not_found', { cwd });
  }
  if (opts.mode) policy.mode = opts.mode;

  const engine = new PolicyEngine(policy);
  const adapter = getAdapter(opts.provider);
  const tailer = new TerminalTailer({ maxLines: 300, maxChars: 24_000 });

  const { command, args } = opts.command
    ? { command: opts.command, args: Array.from(opts.args ?? []) }
    : defaultProviderCommand(opts.provider);

  let pty;
  try {
    pty = spawnPty(command, args, { cwd, logger });
  } catch (err) {
    if (err instanceof PtyUnavailableError) {
      process.stderr.write(`[yessir] ${err.message}\n`);
      return 2;
    }
    if (err instanceof ProviderBinaryNotFoundError) {
      process.stderr.write(`[yessir] ${err.message}\n`);
      logger.error('run.binary_not_found', {
        binary: err.binary,
        searched: err.searched.length
      });
      return 127;
    }
    throw err;
  }

  const writer = new TerminalWriter(
    { write: (data) => pty.write(data) },
    { logger }
  );
  const reviewer: AiReviewer = opts.noAi ? new NoopReviewer() : opts.reviewer ?? new NoopReviewer();
  const stdout = opts.stdout ?? process.stdout;
  const stdin = opts.stdin ?? process.stdin;

  pty.onData((chunk) => {
    stdout.write(chunk);
    tailer.push(chunk);
    writer.notifyRichOutput();
  });

  let exitCode: number | null = 0;
  let exited = false;
  const exitPromise = new Promise<number>((resolve) => {
    pty.onExit((code) => {
      exited = true;
      exitCode = code ?? 0;
      if (opts.onExit) opts.onExit(exitCode);
      resolve(exitCode);
    });
  });

  // Forward user keystrokes unchanged (rawMode preserves interactive behavior).
  let stdinHandler: ((chunk: Buffer | string) => void) | null = null;
  if (stdin && stdin.isTTY && typeof stdin.setRawMode === 'function') {
    try {
      stdin.setRawMode(true);
    } catch {
      // Non-fatal; ok if already in raw mode or not a TTY.
    }
  }
  if (stdin) {
    stdinHandler = (chunk) => {
      pty.write(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
    };
    stdin.on('data', stdinHandler);
  }

  if (process.stdout.isTTY) {
    process.stdout.on('resize', () => {
      pty.resize(process.stdout.columns ?? 120, process.stdout.rows ?? 30);
    });
  }

  let lastHandledAt = 0;
  const poller = setInterval(async () => {
    if (exited) return;
    const snap = tailer.snapshot();
    if (snap.chars === 0) return;
    if (Date.now() - snap.lastUpdate < DEFAULT_IDLE_MS) return;
    if (Date.now() - lastHandledAt < DEFAULT_IDLE_MS) return;

    const prompt = adapter.detect(snap.text);
    if (!prompt) return;

    lastHandledAt = Date.now();
    const engineDecision = engine.evaluate(prompt, {
      cwd,
      provider: opts.provider,
      mode: policy.mode
    });
    logger.info('run.decision', {
      kind: engineDecision.detectedKind,
      type: engineDecision.type,
      rule: engineDecision.rule,
      reason: engineDecision.reason
    });

    let finalType = engineDecision.type;
    let replyText: string | undefined;

    if (engineDecision.type === 'ask_ai') {
      if (opts.noAi || !policy.aiReply.enabled) {
        finalType = 'manual';
      } else {
        const reviewerInput: ReviewerInput = {
          prompt,
          ctx: { cwd, provider: opts.provider, mode: policy.mode },
          tail: redactSecrets(tailer.tailLines(policy.aiReply.maxTailLines).join('\n')),
          policySummary: summarizePolicy(policy)
        };
        try {
          const out = await reviewer.review(reviewerInput);
          const translated = toEngineDecision(out);
          finalType = translated.type;
          replyText = out.reply;
          logger.info('run.ai_decision', { decision: out.decision, reason: out.reason });
        } catch (err) {
          finalType = 'manual';
          logger.error('run.ai_failed', { error: (err as Error).message });
        }
      }
    }

    if (opts.dryRun) {
      stdout.write(
        `\n[yessir] dry-run: ${finalType} for ${prompt.kind} (${engineDecision.reason})\n`
      );
      return;
    }

    if (finalType === 'approve') {
      if (replyText) {
        await writer.writeReply(adapter.replyBytes(replyText));
      } else {
        await writer.writeApproval(adapter.approveBytes(prompt));
      }
    } else if (finalType === 'deny') {
      await writer.writeApproval(adapter.denyBytes(prompt), { bumpStreak: false });
      stdout.write(`\n[yessir] blocked: ${engineDecision.reason}\n`);
    } else {
      stdout.write(
        `\n[yessir] manual required: ${engineDecision.reason}. Respond yourself.\n`
      );
    }
  }, POLL_INTERVAL_MS);

  try {
    exitCode = await exitPromise;
  } finally {
    clearInterval(poller);
    if (stdin && stdinHandler) stdin.off('data', stdinHandler);
    if (stdin && stdin.isTTY && typeof stdin.setRawMode === 'function') {
      try {
        stdin.setRawMode(false);
      } catch {
        // ignore
      }
    }
  }

  return exitCode ?? 0;
}
