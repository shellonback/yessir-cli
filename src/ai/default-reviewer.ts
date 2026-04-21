import type { AiReviewer } from './reviewer';
import { NoopReviewer } from './reviewer';
import { ClaudeCliReviewer } from './reviewers/claude-cli';

/**
 * Resolve the default AI reviewer the way users expect:
 *
 * - YESSIR_REVIEWER=noop            → NoopReviewer (always manual)
 * - YESSIR_REVIEWER=claude|claude-cli (default) → ClaudeCliReviewer, spawns
 *   the user's local `claude -p` as the judge. No separate API keys needed.
 *
 * The selector is intentionally narrow; more backends (OpenAI, Anthropic SDK)
 * can be added here when required.
 */
export function getDefaultReviewer(): AiReviewer {
  const name = (process.env.YESSIR_REVIEWER ?? 'claude').toLowerCase();
  switch (name) {
    case 'noop':
    case 'none':
    case 'off':
      return new NoopReviewer();
    case 'claude':
    case 'claude-cli':
    default:
      return new ClaudeCliReviewer();
  }
}
