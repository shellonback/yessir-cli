import * as fs from 'fs';
import * as path from 'path';
import { processHookInput } from '../hook/pretooluse';
import { findPolicyFile, loadPolicy, DEFAULT_POLICY } from '../policy/loader';
import type { HookPreToolUseInput, LoggerLike } from '../types';
import { FileLogger } from '../util/logger';

const LOG_RELATIVE_PATH = path.join('.yessir', 'yessir.log');

export interface HookRunOptions {
  cwd: string;
  input: string;
  now?: () => number;
  logger?: LoggerLike;
}

export interface HookRunResult {
  output: string;
  exitCode: number;
}

export function runHookOnce(opts: HookRunOptions): HookRunResult {
  const cwd = path.resolve(opts.cwd);
  const logger = opts.logger ?? new FileLogger({ file: path.join(cwd, LOG_RELATIVE_PATH) });

  let parsed: HookPreToolUseInput | null = null;
  try {
    const trimmed = opts.input.trim();
    parsed = trimmed.length === 0 ? null : (JSON.parse(trimmed) as HookPreToolUseInput);
  } catch (err) {
    logger.warn('hook.invalid_json', { error: (err as Error).message });
    return writePassthrough(`invalid JSON on stdin: ${(err as Error).message}`);
  }

  if (!parsed) {
    logger.warn('hook.empty_input');
    return writePassthrough('empty hook input');
  }

  const policyPath = findPolicyFile(cwd);
  let policy = DEFAULT_POLICY;
  if (policyPath) {
    try {
      policy = loadPolicy(policyPath);
    } catch (err) {
      logger.error('hook.policy_load_failed', {
        file: policyPath,
        error: (err as Error).message
      });
      return writePassthrough(
        `failed to load policy at ${policyPath}: ${(err as Error).message}`
      );
    }
  } else {
    logger.warn('hook.policy_not_found', { cwd });
  }

  const hookCwd = parsed.cwd ?? cwd;
  const output = processHookInput(parsed, { cwd: hookCwd, policy });
  logger.info('hook.decision', {
    tool: parsed.tool_name,
    decision: output.decision ?? 'passthrough',
    reason: output.reason
  });

  // Also emit a line for quick human inspection of the .log file.
  maybeAppendActivity({
    cwd,
    toolName: String(parsed.tool_name ?? ''),
    decisionOutput: output
  });

  return {
    output: JSON.stringify(output),
    // exit 0 keeps Claude Code in control. Manager uses exit codes only when
    // blocking the tool outright; we prefer to communicate via JSON.
    exitCode: 0
  };
}

function writePassthrough(reason: string): HookRunResult {
  return {
    output: JSON.stringify({ continue: true, reason }),
    exitCode: 0
  };
}

function maybeAppendActivity(params: {
  cwd: string;
  toolName: string;
  decisionOutput: { decision?: string; reason?: string };
}): void {
  try {
    const logDir = path.join(params.cwd, '.yessir');
    if (!fs.existsSync(logDir)) return;
    const line = `${new Date().toISOString()} ${params.toolName} -> ${params.decisionOutput.decision ?? 'passthrough'} (${params.decisionOutput.reason ?? ''})\n`;
    fs.appendFileSync(path.join(logDir, 'yessir.log'), line);
  } catch {
    // Best-effort logging. Never fail the hook because of IO.
  }
}
