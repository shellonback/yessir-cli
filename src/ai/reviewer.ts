import type { Decision, DetectedPrompt, EvaluationContext, Policy } from '../types';

export interface ReviewerInput {
  prompt: DetectedPrompt;
  ctx: EvaluationContext;
  tail: string;
  policySummary: string;
  gitStatus?: string;
}

export interface ReviewerOutput {
  decision: 'approve' | 'deny' | 'manual' | 'reply';
  reply?: string;
  reason: string;
  model?: string;
}

export interface AiReviewer {
  readonly name: string;
  review(input: ReviewerInput): Promise<ReviewerOutput>;
}

export class NoopReviewer implements AiReviewer {
  readonly name = 'noop';
  async review(input: ReviewerInput): Promise<ReviewerOutput> {
    // The default reviewer is intentionally conservative: it never approves
    // anything on its own. The engine should upgrade to a real reviewer for
    // AI mode to be useful.
    return {
      decision: 'manual',
      reason: `no AI reviewer configured; escalating ${input.prompt.kind} to user`,
      model: 'noop'
    };
  }
}

export function toEngineDecision(output: ReviewerOutput): Decision {
  switch (output.decision) {
    case 'approve':
      return { type: 'approve', reason: output.reason, source: 'ai' };
    case 'deny':
      return { type: 'deny', reason: output.reason, source: 'ai' };
    case 'reply':
      return { type: 'approve', reason: output.reason, source: 'ai' };
    case 'manual':
    default:
      return { type: 'manual', reason: output.reason, source: 'ai' };
  }
}

export function summarizePolicy(policy: Policy): string {
  const lines: string[] = [];
  lines.push(`mode: ${policy.mode}`);
  lines.push(`allow.commands: ${policy.allow.commands.length} rules`);
  lines.push(`deny.commands: ${policy.deny.commands.length} rules`);
  lines.push(`require_manual.commands: ${policy.requireManual.commands.length} rules`);
  lines.push(`ai_reply.enabled: ${policy.aiReply.enabled}`);
  return lines.join('\n');
}

const SECRET_PATTERNS: RegExp[] = [
  /(?:api[_-]?key|secret|token|password|bearer)\s*[:=]\s*[A-Za-z0-9_\-\.]{8,}/gi,
  /sk-[A-Za-z0-9]{10,}/g,
  /ghp_[A-Za-z0-9]{20,}/g,
  /AKIA[0-9A-Z]{16}/g,
  /-----BEGIN (?:RSA |DSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END [^-]+-----/g
];

export function redactSecrets(input: string): string {
  if (!input) return '';
  let out = input;
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, '[REDACTED]');
  }
  return out;
}
