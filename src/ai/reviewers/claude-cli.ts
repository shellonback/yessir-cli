import { spawn } from 'child_process';
import type { AiReviewer, ReviewerInput, ReviewerOutput } from '../reviewer';

export interface ClaudeCliReviewerOptions {
  binary?: string;
  timeoutMs?: number;
  extraArgs?: readonly string[];
}

/**
 * AI reviewer that uses the user's existing `claude` CLI as the judge.
 *
 * We spawn `claude -p <prompt>` with JSON output, parse the single JSON
 * decision, and map it to a ReviewerOutput. The review subprocess runs with
 * `YESSIR_BYPASS=1` set so that if it somehow triggers the hook, the hook
 * returns a passthrough — preventing infinite recursion.
 */
export class ClaudeCliReviewer implements AiReviewer {
  readonly name = 'claude-cli';
  private readonly binary: string;
  private readonly timeoutMs: number;
  private readonly extraArgs: readonly string[];

  constructor(options: ClaudeCliReviewerOptions = {}) {
    this.binary = options.binary || process.env.YESSIR_REVIEWER_BINARY || 'claude';
    const envTimeout = Number(process.env.YESSIR_REVIEWER_TIMEOUT_MS);
    this.timeoutMs =
      options.timeoutMs ?? (Number.isFinite(envTimeout) && envTimeout > 0 ? envTimeout : 30_000);
    this.extraArgs = options.extraArgs ?? [];
  }

  async review(input: ReviewerInput): Promise<ReviewerOutput> {
    const prompt = buildPrompt(input);
    try {
      const raw = await this.runOnce(prompt);
      return parseResponse(raw);
    } catch (err) {
      return {
        decision: 'manual',
        reason: `claude reviewer failed: ${(err as Error)?.message ?? 'unknown error'}`,
        model: 'claude-cli'
      };
    }
  }

  private runOnce(prompt: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const args = ['-p', '--output-format=json', ...this.extraArgs];
      const env: NodeJS.ProcessEnv = { ...process.env, YESSIR_BYPASS: '1', CI: '1' };
      const child = spawn(this.binary, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env
      });
      let out = '';
      let errBuf = '';
      let settled = false;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn();
      };
      const timer = setTimeout(() => {
        try {
          child.kill('SIGTERM');
        } catch {
          // ignore
        }
        finish(() => reject(new Error(`timeout after ${this.timeoutMs}ms`)));
      }, this.timeoutMs);

      child.stdout?.on('data', (d) => {
        out += d.toString('utf8');
      });
      child.stderr?.on('data', (d) => {
        errBuf += d.toString('utf8');
      });
      child.on('error', (e) => finish(() => reject(e)));
      child.on('close', (code) => {
        if (code === 0) {
          finish(() => resolve(out));
        } else {
          finish(() =>
            reject(new Error(`claude exited ${code}: ${errBuf.slice(0, 240)}`))
          );
        }
      });

      try {
        child.stdin?.write(prompt);
        child.stdin?.end();
      } catch (e) {
        finish(() => reject(e as Error));
      }
    });
  }
}

export function buildPrompt(input: ReviewerInput): string {
  const lines: string[] = [];
  lines.push('You are a safety reviewer for an autonomous coding agent.');
  lines.push('');
  lines.push(`Action kind: ${input.prompt.kind}`);
  if (input.prompt.command) {
    lines.push(`Proposed command: \`${input.prompt.command}\``);
  }
  if (input.prompt.target) {
    lines.push(`File target: ${input.prompt.target}`);
  }
  if (input.prompt.question) {
    lines.push(`Agent asked: "${input.prompt.question}"`);
  }
  lines.push(`Provider: ${input.prompt.provider}`);
  lines.push(`Working directory: ${input.ctx.cwd}`);
  lines.push(`Policy mode: ${input.ctx.mode}`);
  lines.push('');
  lines.push('Policy summary:');
  lines.push(input.policySummary);
  if (input.tail && input.tail.trim().length > 0) {
    lines.push('');
    lines.push('Recent terminal tail (secrets redacted):');
    lines.push('---');
    lines.push(input.tail.slice(-2500));
    lines.push('---');
  }
  lines.push('');
  lines.push('Respond with a single JSON object, no Markdown, no preamble.');
  lines.push('Schema:');
  lines.push(
    '{"decision":"approve"|"deny"|"manual"|"reply","reply":"text if you chose reply, else omit","reason":"one sentence"}'
  );
  lines.push('');
  lines.push('Rules:');
  lines.push('- Approve when the action is reasonable for the stated goal and not destructive.');
  lines.push('- Deny when the action is destructive, leaks secrets, or clearly wrong.');
  lines.push('- Manual when you are unsure — the human will decide.');
  lines.push('- Reply with a short text answer when the agent asked a workflow question.');
  return lines.join('\n');
}

interface ClaudeJsonResult {
  result?: string;
  content?: unknown;
  text?: string;
  is_error?: boolean;
}

export function parseResponse(raw: string): ReviewerOutput {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { decision: 'manual', reason: 'reviewer returned empty output', model: 'claude-cli' };
  }
  let wrapperText: string | null = null;
  try {
    const parsed = JSON.parse(trimmed) as ClaudeJsonResult;
    if (typeof parsed.result === 'string') wrapperText = parsed.result;
    else if (typeof parsed.text === 'string') wrapperText = parsed.text;
    else if (typeof parsed.content === 'string') wrapperText = parsed.content;
    else wrapperText = trimmed;
  } catch {
    wrapperText = trimmed;
  }
  if (!wrapperText) {
    return { decision: 'manual', reason: 'reviewer returned no text', model: 'claude-cli' };
  }
  const jsonMatch = wrapperText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return {
      decision: 'manual',
      reason: 'reviewer did not emit a JSON decision',
      model: 'claude-cli'
    };
  }
  try {
    const obj = JSON.parse(jsonMatch[0]) as {
      decision?: string;
      reply?: string;
      reason?: string;
    };
    const decision = normalizeDecision(obj.decision);
    return {
      decision,
      reply: typeof obj.reply === 'string' ? obj.reply : undefined,
      reason: obj.reason ?? 'reviewer did not explain',
      model: 'claude-cli'
    };
  } catch {
    return {
      decision: 'manual',
      reason: 'reviewer JSON was invalid',
      model: 'claude-cli'
    };
  }
}

function normalizeDecision(value: unknown): 'approve' | 'deny' | 'manual' | 'reply' {
  const s = String(value ?? '').toLowerCase();
  if (s === 'approve' || s === 'allow' || s === 'yes') return 'approve';
  if (s === 'deny' || s === 'block' || s === 'no') return 'deny';
  if (s === 'reply' || s === 'answer') return 'reply';
  return 'manual';
}
