import type { DetectedPrompt } from '../../types';
import type { ProviderAdapter } from '../adapter';

const YN_RE = /\((Y\/n|y\/N|Y\/N|yes\/no)\)\s*$/im;
const QUESTION_RE = /([^.!?\n]{6,})\?\s*$/m;

export class GenericAdapter implements ProviderAdapter {
  readonly name = 'generic' as const;

  detect(tail: string): DetectedPrompt | null {
    if (!tail) return null;
    const lastLine = (tail.split('\n').pop() ?? '').trim();
    if (YN_RE.test(lastLine)) {
      return { kind: 'yes_no', raw: lastLine, provider: 'generic' };
    }
    const m = QUESTION_RE.exec(lastLine);
    if (m && m[1]) {
      return { kind: 'question', raw: m[0], question: m[1].trim(), provider: 'generic' };
    }
    return null;
  }

  approveBytes(_prompt: DetectedPrompt): string {
    return 'y\r';
  }

  denyBytes(_prompt: DetectedPrompt): string {
    return 'n\r';
  }

  replyBytes(text: string): string {
    if (!text) return '';
    return text + '\r';
  }
}
