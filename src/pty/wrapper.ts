import type { LoggerLike } from '../types';

export interface PtySpawnOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  cols?: number;
  rows?: number;
  name?: string;
  logger?: LoggerLike;
}

export interface PtyHandle {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
  onData(handler: (chunk: string) => void): void;
  onExit(handler: (code: number | null, signal: string | null) => void): void;
}

interface PtyModuleLike {
  spawn(
    file: string,
    args: readonly string[],
    opts: {
      name?: string;
      cwd?: string;
      env?: NodeJS.ProcessEnv;
      cols?: number;
      rows?: number;
    }
  ): {
    write(data: string): void;
    resize(cols: number, rows: number): void;
    kill(signal?: string): void;
    onData(handler: (chunk: string) => void): { dispose(): void } | void;
    onExit(handler: (event: { exitCode: number; signal?: number }) => void): { dispose(): void } | void;
  };
}

export class PtyUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PtyUnavailableError';
  }
}

function requirePty(): PtyModuleLike {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('node-pty') as PtyModuleLike;
    return mod;
  } catch (err) {
    throw new PtyUnavailableError(
      'node-pty is not installed. Run `npm install node-pty` or use `yessir hook` for the no-PTY path.'
    );
  }
}

export function spawnPty(
  command: string,
  args: readonly string[],
  options: PtySpawnOptions = {}
): PtyHandle {
  if (!command) throw new TypeError('spawnPty requires a command');
  const pty = requirePty();
  const cols = options.cols ?? process.stdout.columns ?? 120;
  const rows = options.rows ?? process.stdout.rows ?? 30;
  const name = options.name ?? process.env.TERM ?? 'xterm-256color';
  const child = pty.spawn(command, Array.from(args ?? []), {
    name,
    cwd: options.cwd ?? process.cwd(),
    env: options.env ?? process.env,
    cols,
    rows
  });

  options.logger?.info('pty.spawned', { command, args, cwd: options.cwd ?? process.cwd() });

  return {
    write(data: string): void {
      if (!data) return;
      child.write(data);
    },
    resize(c: number, r: number): void {
      try {
        child.resize(Math.max(1, Math.floor(c)), Math.max(1, Math.floor(r)));
      } catch (err) {
        options.logger?.warn('pty.resize.failed', { error: (err as Error).message });
      }
    },
    kill(signal?: string): void {
      try {
        child.kill(signal);
      } catch (err) {
        options.logger?.warn('pty.kill.failed', { error: (err as Error).message });
      }
    },
    onData(handler: (chunk: string) => void): void {
      child.onData(handler);
    },
    onExit(handler: (code: number | null, signal: string | null) => void): void {
      child.onExit((event) => {
        handler(event.exitCode ?? null, event.signal != null ? String(event.signal) : null);
      });
    }
  };
}

export function defaultProviderCommand(provider: string): { command: string; args: string[] } {
  switch (provider) {
    case 'claude':
      return { command: process.platform === 'win32' ? 'claude.cmd' : 'claude', args: [] };
    case 'codex':
      return { command: process.platform === 'win32' ? 'codex.cmd' : 'codex', args: [] };
    case 'gemini':
      return { command: process.platform === 'win32' ? 'gemini.cmd' : 'gemini', args: [] };
    case 'aider':
      return { command: 'aider', args: [] };
    default:
      return {
        command: process.env.SHELL || (process.platform === 'win32' ? 'cmd.exe' : 'bash'),
        args: []
      };
  }
}
