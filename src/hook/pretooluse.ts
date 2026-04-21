import type { DetectedPrompt, HookDecisionOutput, HookPreToolUseInput } from '../types';
import { PolicyEngine } from '../policy/engine';
import type { Policy } from '../types';
import type { AiReviewer, ReviewerInput } from '../ai/reviewer';
import { summarizePolicy, toEngineDecision } from '../ai/reviewer';
import { getDefaultReviewer } from '../ai/default-reviewer';

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
  void policy;
  // Keep the permissionDecisionReason short — some Claude Code versions
  // truncate or ignore the hookSpecificOutput entirely if this string is
  // too long. One line, no newlines.
  const shortReason = shortenReason(decision.reason);
  switch (decision.type) {
    case 'approve':
      // IMPORTANT: emit ONLY the new-schema field. Older versions of Claude
      // Code still read top-level `decision: "approve"`, but current versions
      // prefer hookSpecificOutput.permissionDecision, and emitting both
      // occasionally caused the agent to still show its native permission
      // dialog. Keeping the response minimal is the safe bet.
      return {
        continue: true,
        suppressOutput: true,
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'allow',
          permissionDecisionReason: shortReason
        }
      };
    case 'deny':
      return {
        continue: false,
        stopReason: shortReason,
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: shortReason
        }
      };
    case 'ask_ai':
    case 'manual':
    default: {
      return {
        continue: true,
        reason: shortReason,
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'ask',
          permissionDecisionReason: shortReason
        }
      };
    }
  }
}

function shortenReason(reason: string | undefined): string {
  if (!reason) return 'yessir: no reason provided';
  // Collapse all whitespace (newlines, tabs, CR) to a single space and cap
  // the length to something Claude Code will comfortably surface.
  const oneLine = reason.replace(/\s+/g, ' ').trim();
  if (oneLine.length <= 240) return oneLine;
  return oneLine.slice(0, 237) + '...';
}

export interface HookProcessOptions {
  cwd: string;
  policy: Policy;
  /** Override for tests; in production uses getDefaultReviewer(). */
  reviewer?: AiReviewer;
  /**
   * Scope: 'session' means this invocation only intercepts calls coming from a
   * yessir-originated session (env.YESSIR_ACTIVE=1). 'all' means intercept
   * every call. Defaults to 'session' — the provider runs wild unless the user
   * explicitly wrapped it with `yessir <provider>`. Override with
   * `YESSIR_SCOPE=all` for the legacy "always on" behavior.
   */
  scope?: 'session' | 'all';
}

function resolveScope(opts: HookProcessOptions): 'session' | 'all' {
  if (opts.scope) return opts.scope;
  const env = (process.env.YESSIR_SCOPE ?? '').toLowerCase();
  if (env === 'all' || env === 'always') return 'all';
  return 'session';
}

export async function processHookInput(
  input: HookPreToolUseInput,
  opts: HookProcessOptions
): Promise<HookDecisionOutput> {
  if (!input || typeof input !== 'object') {
    return { continue: true, reason: 'invalid hook payload (escalated to user)' };
  }
  if (!input.tool_name) {
    return { continue: true, reason: 'missing tool_name (escalated to user)' };
  }
  // Honor the anti-recursion bypass: subprocesses spawned BY the AI reviewer
  // set YESSIR_BYPASS=1 so their tool calls don't trigger yessir again.
  if (process.env.YESSIR_BYPASS === '1') {
    return {
      continue: true,
      reason: 'bypass: YESSIR_BYPASS=1 set by reviewer subprocess'
    };
  }
  // Session scoping: only intercept if this session was launched under
  // yessir (YESSIR_ACTIVE=1). Nude `claude` / `codex` / etc. get a silent
  // passthrough so they behave exactly like yessir is not installed.
  const scope = resolveScope(opts);
  if (scope === 'session' && process.env.YESSIR_ACTIVE !== '1') {
    return {
      continue: true,
      reason: 'passthrough: session not launched under yessir (set YESSIR_SCOPE=all to intercept always)'
    };
  }
  const prompt = hookInputToPrompt(input);
  const engine = new PolicyEngine(opts.policy);
  const ctx = {
    cwd: input.cwd ?? opts.cwd,
    provider: 'claude' as const,
    mode: opts.policy.mode
  };
  const decision = engine.evaluate(prompt, ctx);

  // Deny and require_manual are absolute. Never override them with the AI.
  if (decision.type === 'deny' || decision.type === 'manual') {
    return decisionToHookOutput(decision, opts.policy);
  }

  // `mode: ai` means "ask the AI on every call that isn't flat-out denied".
  // That is why the user set it: they want an AI layer on top, not a shortcut
  // past it. Even a deterministic `approve` gets routed through the reviewer
  // so the model has the final say (and still fits within the deterministic
  // deny/manual guardrails above).
  const aiOnEveryCall = opts.policy.mode === 'ai' && opts.policy.aiReply.enabled;
  const aiOnAskAi =
    decision.type === 'ask_ai' &&
    opts.policy.mode !== 'quick' &&
    opts.policy.aiReply.enabled;
  if (!aiOnEveryCall && !aiOnAskAi) {
    // Deterministic branch — policy decides, no AI call.
    // ask_ai without AI enabled → fall back to manual.
    if (decision.type === 'ask_ai') {
      return decisionToHookOutput(
        { ...decision, type: 'manual', reason: decision.reason },
        opts.policy
      );
    }
    return decisionToHookOutput(decision, opts.policy);
  }

  const reviewer = opts.reviewer ?? getDefaultReviewer();
  const reviewerInput: ReviewerInput = {
    prompt,
    ctx,
    tail: '',
    policySummary: summarizePolicy(opts.policy)
  };
  let reviewerOut;
  try {
    reviewerOut = await reviewer.review(reviewerInput);
  } catch (err) {
    return decisionToHookOutput(
      {
        ...decision,
        type: 'manual',
        reason: `AI reviewer threw: ${(err as Error)?.message ?? 'unknown error'}`
      },
      opts.policy
    );
  }
  const translated = toEngineDecision(reviewerOut);
  const reason = reviewerOut.reason
    ? `AI reviewer (${reviewer.name}): ${reviewerOut.reason}`
    : `AI reviewer (${reviewer.name})`;
  return decisionToHookOutput(
    { ...decision, type: translated.type, reason },
    opts.policy
  );
}
