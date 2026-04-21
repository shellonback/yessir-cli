import type { DetectedPrompt } from '../../types';
import type { ProviderAdapter } from '../adapter';

const COMMAND_RE = /(?:Run|Execute)\s+[`'"]([^`'"\n]+)[`'"]\s*\?/i;
const YN_RE = /\((Y\/n|y\/N|Y\/N)\)\s*$/m;
const PROCEED_RE = /Proceed\?/i;

export class GeminiAdapter implements ProviderAdapter {
  readonly name = 'gemini' as const;

  detect(tail: string): DetectedPrompt | null {
    if (!tail) return null;
    const lines = tail.split('\n');
    const recent = lines.slice(Math.max(0, lines.length - 40)).join('\n');
    const cmd = COMMAND_RE.exec(recent);
    if (cmd && cmd[1]) {
      return { kind: 'command', raw: cmd[0], command: cmd[1].trim(), provider: 'gemini' };
    }
    if (PROCEED_RE.test(recent) || YN_RE.test(recent)) {
      return { kind: 'yes_no', raw: recent.slice(-200), provider: 'gemini' };
    }
    return null;
  }

  approveBytes(_prompt: DetectedPrompt): string {
    return '\r';
  }

  denyBytes(_prompt: DetectedPrompt): string {
    return 'n\r';
  }

  replyBytes(text: string): string {
    if (!text) return '';
    return text + '\r';
  }
}
