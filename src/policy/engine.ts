import type { Decision, DetectedPrompt, EvaluationContext, Policy } from '../types';
import { containsShellMetacharacters, matchCommand, matchPath, normalizeCommand } from './matchers';

const DESTRUCTIVE_HEURISTIC_PATTERNS: RegExp[] = [
  /\brm\s+-[rRfF]+/,
  /\bsudo\b/,
  /\bmkfs\b/,
  /\bdd\s+if=/,
  /\bchown\s+-R\b/,
  /\bchmod\s+-R\s+777/,
  /\bshutdown\b/,
  /\breboot\b/,
  /\bhalt\b/,
  /\bkill\s+-9\s+1\b/,
  /\bcurl\b[^|]*\|\s*(?:bash|sh|zsh)\b/,
  /\bwget\b[^|]*\|\s*(?:bash|sh|zsh)\b/
];

function hasDestructiveHeuristic(command: string): boolean {
  return DESTRUCTIVE_HEURISTIC_PATTERNS.some((re) => re.test(command));
}

export type EngineDecision = Decision & {
  detectedKind: DetectedPrompt['kind'];
  normalized: string;
};

export class PolicyEngine {
  constructor(private readonly policy: Policy) {}

  getPolicy(): Policy {
    return this.policy;
  }

  evaluate(prompt: DetectedPrompt, ctx: EvaluationContext): EngineDecision {
    switch (prompt.kind) {
      case 'command':
        return this.evaluateCommand(prompt);
      case 'file_write':
      case 'file_edit':
        return this.evaluateWrite(prompt);
      case 'yes_no':
        return this.evaluateYesNo(prompt);
      case 'question':
        return this.evaluateQuestion(prompt, ctx);
      default:
        return unknown(prompt, 'unsupported prompt kind');
    }
  }

  private evaluateCommand(prompt: DetectedPrompt): EngineDecision {
    const cmd = normalizeCommand(prompt.command ?? prompt.raw ?? '');
    if (!cmd) {
      return {
        type: 'manual',
        reason: 'empty command',
        source: 'policy',
        detectedKind: prompt.kind,
        normalized: ''
      };
    }

    // Deny is always highest precedence.
    const denied = matchCommand(cmd, this.policy.deny.commands);
    if (denied.matched) {
      return {
        type: 'deny',
        reason: `matched deny rule "${denied.rule}"`,
        source: 'policy',
        rule: denied.rule,
        detectedKind: prompt.kind,
        normalized: cmd
      };
    }

    // Destructive heuristics take precedence over allow to avoid accidental
    // approval of dangerous commands that happen to share a prefix with a
    // benign allow rule (e.g. `git diff * && rm -rf /`).
    if (hasDestructiveHeuristic(cmd) || containsShellMetacharacters(cmd)) {
      // Still allow safe pipelines that explicitly match allow rules verbatim.
      const allowExplicit = matchCommand(cmd, this.policy.allow.commands);
      if (!allowExplicit.matched) {
        return {
          type: 'manual',
          reason: 'command contains shell metacharacters or destructive tokens',
          source: 'policy',
          detectedKind: prompt.kind,
          normalized: cmd
        };
      }
    }

    const manual = matchCommand(cmd, this.policy.requireManual.commands);
    if (manual.matched) {
      return {
        type: 'manual',
        reason: `matched require_manual rule "${manual.rule}"`,
        source: 'policy',
        rule: manual.rule,
        detectedKind: prompt.kind,
        normalized: cmd
      };
    }

    const allowed = matchCommand(cmd, this.policy.allow.commands);
    if (allowed.matched) {
      return {
        type: 'approve',
        reason: `matched allow rule "${allowed.rule}"`,
        source: 'policy',
        rule: allowed.rule,
        detectedKind: prompt.kind,
        normalized: cmd
      };
    }

    // Unknown commands in quick/hybrid modes fall back to manual; ai modes
    // defer to the reviewer.
    if (this.policy.mode === 'ai' && this.policy.aiReply.enabled) {
      return {
        type: 'ask_ai',
        reason: 'unknown command, deferring to AI reviewer',
        source: 'policy',
        detectedKind: prompt.kind,
        normalized: cmd
      };
    }
    if (this.policy.mode === 'hybrid' && this.policy.aiReply.enabled) {
      return {
        type: 'ask_ai',
        reason: 'unknown command, deferring to AI reviewer',
        source: 'policy',
        detectedKind: prompt.kind,
        normalized: cmd
      };
    }
    return {
      type: 'manual',
      reason: 'unknown command and AI reviewer disabled',
      source: 'policy',
      detectedKind: prompt.kind,
      normalized: cmd
    };
  }

  private evaluateWrite(prompt: DetectedPrompt): EngineDecision {
    const target = (prompt.target ?? '').trim();
    if (!target) {
      return {
        type: 'manual',
        reason: 'empty write target',
        source: 'policy',
        detectedKind: prompt.kind,
        normalized: ''
      };
    }
    const allowed = matchPath(target, this.policy.allow.write);
    if (allowed.matched) {
      return {
        type: 'approve',
        reason: `matched allow.write rule "${allowed.rule}"`,
        source: 'policy',
        rule: allowed.rule,
        detectedKind: prompt.kind,
        normalized: target
      };
    }
    if (this.policy.mode !== 'quick' && this.policy.aiReply.enabled) {
      return {
        type: 'ask_ai',
        reason: 'write path not in allow list, deferring to AI reviewer',
        source: 'policy',
        detectedKind: prompt.kind,
        normalized: target
      };
    }
    return {
      type: 'manual',
      reason: 'write path not in allow list',
      source: 'policy',
      detectedKind: prompt.kind,
      normalized: target
    };
  }

  private evaluateYesNo(prompt: DetectedPrompt): EngineDecision {
    // Bare yes/no prompts without a proposed command are ambiguous: defer to
    // AI reviewer in modes that allow it, otherwise manual.
    if (prompt.command) {
      return this.evaluateCommand(prompt);
    }
    if (this.policy.mode !== 'quick' && this.policy.aiReply.enabled) {
      return {
        type: 'ask_ai',
        reason: 'yes/no prompt without explicit command',
        source: 'policy',
        detectedKind: prompt.kind,
        normalized: prompt.raw ?? ''
      };
    }
    return {
      type: 'manual',
      reason: 'yes/no prompt requires human judgement in quick mode',
      source: 'policy',
      detectedKind: prompt.kind,
      normalized: prompt.raw ?? ''
    };
  }

  private evaluateQuestion(prompt: DetectedPrompt, _ctx: EvaluationContext): EngineDecision {
    if (this.policy.mode !== 'ai' && !this.policy.aiReply.enabled) {
      return {
        type: 'manual',
        reason: 'open question and AI reviewer disabled',
        source: 'policy',
        detectedKind: prompt.kind,
        normalized: prompt.question ?? prompt.raw ?? ''
      };
    }
    return {
      type: 'ask_ai',
      reason: 'routing open question to AI reviewer',
      source: 'policy',
      detectedKind: prompt.kind,
      normalized: prompt.question ?? prompt.raw ?? ''
    };
  }
}

function unknown(prompt: DetectedPrompt, reason: string): EngineDecision {
  return {
    type: 'manual',
    reason,
    source: 'unknown',
    detectedKind: prompt.kind,
    normalized: prompt.raw ?? ''
  };
}
