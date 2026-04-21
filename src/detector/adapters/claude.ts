import type { DetectedPrompt } from '../../types';
import type { ProviderAdapter } from '../adapter';

// Patterns lifted and simplified from PromptOps Manager's claude-code-cli-adapter.
// These run against ANSI-stripped output.
const COMMAND_RE = /(?:Run|Execute)\s+(?:command\s+)?[`'"]([^`'"\n]+)[`'"]\s*\?/i;
const WRITE_RE = /(?:Write|Create)\s+(?:file\s+)?[`'"]([^`'"\n]+)[`'"]\s*\?/i;
const EDIT_RE = /(?:Edit|Modify|Update)\s+(?:file\s+)?[`'"]([^`'"\n]+)[`'"]\s*\?/i;
const DELETE_RE = /Delete\s+(?:file\s+)?[`'"]([^`'"\n]+)[`'"]\s*\?/i;
const ALLOW_RE = /Allow\s+(.+?)\?/i;
const DO_YOU_WANT_RE = /Do you want to\s+(.+?)\?/i;
const YN_RE = /\((Y\/n|y\/N|Y\/N)\)\s*$/m;
const NUMBERED_MENU_RE = /^\s*\d+\.\s+Yes/mi;

const QUESTION_TAIL_RE = /([^.!?\n]{8,})\?\s*$/;

export class ClaudeAdapter implements ProviderAdapter {
  readonly name = 'claude' as const;

  detect(tail: string): DetectedPrompt | null {
    if (!tail) return null;
    // Use only the last ~40 lines for prompt detection — Claude Code prompts
    // always appear near the trailing edge of the transcript.
    const lines = tail.split('\n');
    const scanFrom = Math.max(0, lines.length - 40);
    const recent = lines.slice(scanFrom).join('\n');

    const cmd = COMMAND_RE.exec(recent);
    if (cmd && cmd[1]) {
      return {
        kind: 'command',
        raw: cmd[0],
        command: cmd[1].trim(),
        provider: 'claude'
      };
    }

    const write = WRITE_RE.exec(recent);
    if (write && write[1]) {
      return {
        kind: 'file_write',
        raw: write[0],
        target: write[1].trim(),
        provider: 'claude'
      };
    }

    const edit = EDIT_RE.exec(recent);
    if (edit && edit[1]) {
      return {
        kind: 'file_edit',
        raw: edit[0],
        target: edit[1].trim(),
        provider: 'claude'
      };
    }

    const del = DELETE_RE.exec(recent);
    if (del && del[1]) {
      return {
        kind: 'file_edit',
        raw: del[0],
        target: del[1].trim(),
        provider: 'claude'
      };
    }

    const allow = ALLOW_RE.exec(recent);
    if (allow && allow[1]) {
      const arg = allow[1].trim();
      return {
        kind: 'command',
        raw: allow[0],
        command: arg,
        provider: 'claude'
      };
    }

    const intent = DO_YOU_WANT_RE.exec(recent);
    if (intent && intent[1]) {
      return {
        kind: 'question',
        raw: intent[0],
        question: intent[1].trim(),
        provider: 'claude'
      };
    }

    if (YN_RE.test(recent) || NUMBERED_MENU_RE.test(recent)) {
      return {
        kind: 'yes_no',
        raw: recent.slice(-200),
        provider: 'claude'
      };
    }

    const question = QUESTION_TAIL_RE.exec(recent.split('\n').pop() ?? '');
    if (question && question[1]) {
      return {
        kind: 'question',
        raw: question[0],
        question: question[1].trim(),
        provider: 'claude'
      };
    }

    return null;
  }

  approveBytes(prompt: DetectedPrompt): string {
    // Claude Code menus accept the option number directly (`1\r`). That is
    // more reliable than the older arrow-based scheme because the cursor
    // might not start on option 1 after re-renders. Fall back to plain Enter
    // only for classic `(Y/n)` confirmations where the default is already Yes.
    if (/\b1\.\s+Yes/i.test(prompt.raw)) {
      return '1\r';
    }
    return '\r';
  }

  denyBytes(prompt: DetectedPrompt): string {
    // 3-option menu: "1. Yes   2. Yes, allow…   3. No" → pick 3.
    if (/\b2\.\s+Yes,?\s+(?:and|allow)/i.test(prompt.raw)) {
      return '3\r';
    }
    // 2-option menu: "1. Yes   2. No" → pick 2.
    if (/\b2\.\s+No\b/i.test(prompt.raw) || /\b1\.\s+Yes/i.test(prompt.raw)) {
      return '2\r';
    }
    // Classic (Y/n) confirmation.
    return 'n\r';
  }

  replyBytes(text: string): string {
    if (!text) return '';
    // Use bracketed paste for multi-line replies to avoid interpretation.
    if (text.includes('\n')) {
      return '[200~' + text + '[201~\r';
    }
    return text + '\r';
  }
}
