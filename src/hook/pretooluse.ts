import type { DetectedPrompt, HookDecisionOutput, HookPreToolUseInput } from '../types';
import { PolicyEngine } from '../policy/engine';
import type { Policy } from '../types';

/**
 * Translate a Claude Code PreToolUse hook payload into a DetectedPrompt.
 * Mirrors the tool taxonomy Manager relies on; anything we cannot classify
 * is surfaced as a `yes_no` prompt so the policy engine will escalate.
 */
export function hookInputToPrompt(input: HookPreToolUseInput): DetectedPrompt {
  const toolName = String(input.tool_name ?? '').toLowerCase();
  const ti = input.tool_input ?? {};
  if (toolName === 'bash' || toolName === 'shell' || toolName === 'run') {
    const cmd = readString(ti.command) || readString((ti as { cmd?: unknown }).cmd) || '';
    return {
      kind: 'command',
      raw: cmd,
      command: cmd,
      provider: 'claude'
    };
  }
  if (toolName === 'write' || toolName === 'create') {
    const target = readString(ti.file_path) || readString(ti.path) || '';
    return {
      kind: 'file_write',
      raw: `write ${target}`,
      target,
      provider: 'claude'
    };
  }
  if (toolName === 'edit' || toolName === 'multiedit' || toolName === 'notebookedit') {
    const target = readString(ti.file_path) || readString(ti.path) || '';
    return {
      kind: 'file_edit',
      raw: `edit ${target}`,
      target,
      provider: 'claude'
    };
  }
  if (toolName === 'read' || toolName === 'glob' || toolName === 'grep') {
    // Reads are typically always allowed; treat as file_edit against the allow.read list.
    const target = readString(ti.file_path) || readString(ti.path) || readString(ti.pattern) || '';
    return {
      kind: 'file_edit',
      raw: `${toolName} ${target}`,
      target,
      provider: 'claude'
    };
  }
  // Fallback: ask-AI question with tool name + JSON.
  return {
    kind: 'question',
    raw: `${toolName}: ${safeJson(ti)}`,
    question: `Claude Code wants to invoke tool "${toolName}"`,
    provider: 'claude'
  };
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return '[unserializable tool input]';
  }
}

export function decisionToHookOutput(
  decision: ReturnType<PolicyEngine['evaluate']>,
  policy: Policy
): HookDecisionOutput {
  switch (decision.type) {
    case 'approve':
      return {
        continue: true,
        decision: 'approve',
        reason: decision.reason,
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'allow',
          permissionDecisionReason: decision.reason
        }
      };
    case 'deny':
      return {
        continue: false,
        stopReason: decision.reason,
        decision: 'block',
        reason: decision.reason,
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: decision.reason
        }
      };
    case 'ask_ai':
    case 'manual':
    default: {
      // Do not auto-approve; let Claude Code prompt the human.
      const reason = decision.reason || 'escalated to user';
      void policy; // policy unused here but kept for future refinements.
      return {
        continue: true,
        reason,
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'ask',
          permissionDecisionReason: reason
        }
      };
    }
  }
}

export interface HookProcessOptions {
  cwd: string;
  policy: Policy;
}

export function processHookInput(
  input: HookPreToolUseInput,
  opts: HookProcessOptions
): HookDecisionOutput {
  if (!input || typeof input !== 'object') {
    return { continue: true, reason: 'invalid hook payload (escalated to user)' };
  }
  if (!input.tool_name) {
    return { continue: true, reason: 'missing tool_name (escalated to user)' };
  }
  const prompt = hookInputToPrompt(input);
  const engine = new PolicyEngine(opts.policy);
  const decision = engine.evaluate(prompt, {
    cwd: input.cwd ?? opts.cwd,
    provider: 'claude',
    mode: opts.policy.mode
  });
  return decisionToHookOutput(decision, opts.policy);
}
