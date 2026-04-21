import type { DetectedPrompt, Provider } from '../types';

export interface ProviderAdapter {
  readonly name: Provider;
  detect(tail: string): DetectedPrompt | null;
  /**
   * Bytes written to approve the most recent prompt. Keep conservative: we
   * default to pressing Enter (assumes `Yes` is the default choice).
   */
  approveBytes(prompt: DetectedPrompt): string;
  /** Bytes written to deny. Uses a conservative `n` + Enter. */
  denyBytes(prompt: DetectedPrompt): string;
  /**
   * Bytes written to inject an arbitrary textual reply. Implementations must
   * be idempotent and safe to call with multi-line replies.
   */
  replyBytes(text: string): string;
}
