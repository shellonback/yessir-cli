export type Mode = 'quick' | 'ai' | 'hybrid';

export type DecisionSource = 'policy' | 'ai' | 'fallback' | 'unknown';

export type Decision =
  | { type: 'approve'; reason: string; source: DecisionSource; rule?: string }
  | { type: 'deny'; reason: string; source: DecisionSource; rule?: string }
  | { type: 'manual'; reason: string; source: DecisionSource; rule?: string }
  | { type: 'ask_ai'; reason: string; source: DecisionSource; rule?: string };

export interface Policy {
  mode: Mode;
  allow: {
    commands: string[];
    read: string[];
    write: string[];
  };
  deny: {
    commands: string[];
  };
  requireManual: {
    commands: string[];
  };
  aiReply: {
    enabled: boolean;
    model: string;
    maxTailLines: number;
    requireManualOn: string[];
  };
}

export type Provider = 'claude' | 'codex' | 'gemini' | 'aider' | 'generic';

export interface DetectedPrompt {
  kind: 'command' | 'file_write' | 'file_edit' | 'question' | 'yes_no';
  raw: string;
  command?: string;
  target?: string;
  question?: string;
  provider: Provider;
}

export interface EvaluationContext {
  cwd: string;
  provider: Provider;
  mode: Mode;
}

export interface HookPreToolUseInput {
  session_id?: string;
  transcript_path?: string;
  cwd?: string;
  tool_name: string;
  tool_input: Record<string, unknown>;
  hook_event_name?: string;
  permission_mode?: string;
}

export interface HookDecisionOutput {
  continue?: boolean;
  stopReason?: string;
  suppressOutput?: boolean;
  decision?: 'approve' | 'block';
  reason?: string;
  hookSpecificOutput?: Record<string, unknown>;
}

export interface LoggerLike {
  info(event: string, data?: Record<string, unknown>): void;
  warn(event: string, data?: Record<string, unknown>): void;
  error(event: string, data?: Record<string, unknown>): void;
}
