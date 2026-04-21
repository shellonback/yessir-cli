import * as fs from 'fs';
import * as path from 'path';
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

export class ProviderBinaryNotFoundError extends Error {
  constructor(readonly binary: string, readonly searched: readonly string[]) {
    super(
      `could not find executable "${binary}" in PATH. ` +
        `Install the provider CLI and make sure it's reachable (e.g. \`which ${binary}\`).`
    );
    this.name = 'ProviderBinaryNotFoundError';
  }
}

/**
 * Look up `command` against $PATH and return an absolute path.
 *
 * `node-pty` uses posix_spawnp on POSIX, which on some platforms refuses to
 * search PATH the way `child_process.spawn` does, and blows up with the
 * famously unhelpful "posix_spawnp failed." error. Resolving the binary
 * ourselves makes the error path deterministic and gives us a chance to
 * surface a clear message.
 */
export function resolveBinary(command: string, env: NodeJS.ProcessEnv = process.env): string {
  if (!command) return command;
  if (command.includes('/') || (process.platform === 'win32' && command.includes('\\'))) {
    return command;
  }
  const pathSep = process.platform === 'win32' ? ';' : ':';
  const pathEnv = env.PATH ?? env.Path ?? '';
  const exts =
    process.platform === 'win32'
      ? (env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';').map((e) => e.toLowerCase())
      : [''];
  for (const dir of pathEnv.split(pathSep)) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = path.join(dir, command + ext);
      try {
        const st = fs.statSync(candidate);
        if (!st.isFile()) continue;
        if (process.platform === 'win32') return candidate;
        if ((st.mode & 0o111) !== 0) return candidate;
      } catch {
        // next
      }
    }
  }
  throw new ProviderBinaryNotFoundError(
    command,
    pathEnv.split(pathSep).filter(Boolean)
  );
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
  // Session-scoping: tag the child so the PreToolUse hook knows this provider
  // was launched under yessir. The hook checks YESSIR_ACTIVE=1 and otherwise
  // passes through — nude `claude` / `codex` behave as if yessir isn't there.
  const baseEnv = options.env ?? process.env;
  const env: NodeJS.ProcessEnv = { ...baseEnv, YESSIR_ACTIVE: '1' };
  // Resolve to an absolute path: node-pty uses posix_spawnp which does not
  // reliably search PATH, so `pty.spawn("claude", ...)` fails with the
  // unhelpful "posix_spawnp failed." even when `which claude` finds it.
  const resolved = resolveBinary(command, env);
  const child = pty.spawn(resolved, Array.from(args ?? []), {
    name,
    cwd: options.cwd ?? process.cwd(),
    env,
    cols,
    rows
  });

  options.logger?.info('pty.spawned', {
    command,
    resolved,
    args,
    cwd: options.cwd ?? process.cwd()
  });

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
