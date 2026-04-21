import type { Provider } from '../types';
import type { ProviderAdapter } from './adapter';
import { ClaudeAdapter } from './adapters/claude';
import { CodexAdapter } from './adapters/codex';
import { GeminiAdapter } from './adapters/gemini';
import { GenericAdapter } from './adapters/generic';

export function getAdapter(provider: Provider): ProviderAdapter {
  switch (provider) {
    case 'claude':
      return new ClaudeAdapter();
    case 'codex':
      return new CodexAdapter();
    case 'gemini':
      return new GeminiAdapter();
    case 'aider':
    case 'generic':
    default:
      return new GenericAdapter();
  }
}

export type { ProviderAdapter } from './adapter';
