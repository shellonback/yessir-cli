import * as fs from 'fs';
import * as path from 'path';
import { runInit } from './commands/init';
import { runHookOnce } from './commands/hook';
import { runExplain } from './commands/explain';
import { runDoctor } from './commands/doctor';
import { runWrap } from './commands/run';
import type { Mode, Provider } from './types';

function readPackageVersion(): string {
  const candidates = [
    path.resolve(__dirname, '..', '..', 'package.json'),
    path.resolve(__dirname, '..', '..', '..', 'package.json')
  ];
  for (const p of candidates) {
    try {
      const raw = fs.readFileSync(p, 'utf8');
      const pkg = JSON.parse(raw) as { version?: string };
      if (pkg && typeof pkg.version === 'string') return pkg.version;
    } catch {
      // try next candidate
    }
  }
  return '0.0.0-unknown';
}

const VERSION = readPackageVersion();

const USAGE = `Yessir v${VERSION}
A local safety layer for terminal-based AI coding agents.

Usage:
  yessir init [--force] [--hook]
  yessir hook
  yessir claude [--mode quick|ai|hybrid] [--dry-run] [--no-ai]
  yessir codex  [--mode quick|ai|hybrid] [--dry-run] [--no-ai]
  yessir gemini [--mode quick|ai|hybrid] [--dry-run] [--no-ai]
  yessir -- <command> [args...]
  yessir doctor
  yessir explain <command>
  yessir --version
  yessir --help

Flags:
  --mode <m>        Override mode: quick | ai | hybrid
  --dry-run         Show decisions without injecting responses
  --no-ai           Disable the AI reviewer
  --log-level <l>   debug | info | warn | error
  --policy <path>   Explicit policy file path

Notes:
  'hook' is invoked by Claude Code via PreToolUse. It reads JSON from stdin
  and writes a decision object to stdout. Wire it with \`yessir init --hook\`.
`;

interface ParsedArgs {
  command: string | null;
  positional: string[];
  passthrough: string[];
  flags: Record<string, string | boolean>;
}

export async function main(argv: readonly string[]): Promise<number> {
  const parsed = parseArgs(argv);
  const cmd = parsed.command;

  if (parsed.flags['version'] || parsed.flags['v'] || cmd === '--version') {
    process.stdout.write(`yessir ${VERSION}\n`);
    return 0;
  }
  if (parsed.flags['help'] || parsed.flags['h'] || cmd === '--help' || cmd === null) {
    process.stdout.write(USAGE);
    return 0;
  }

  try {
    switch (cmd) {
      case 'init':
        return await runInitCmd(parsed);
      case 'hook':
        return await runHookCmd();
      case 'explain':
        return await runExplainCmd(parsed);
      case 'doctor':
        return await runDoctorCmd();
      case 'claude':
      case 'codex':
      case 'gemini':
      case 'aider':
        return await runProviderCmd(cmd as Provider, parsed);
      default:
        if (cmd && parsed.passthrough.length > 0) {
          return await runCustomCmd(parsed);
        }
        process.stderr.write(`unknown command: ${cmd}\n\n${USAGE}`);
        return 64;
    }
  } catch (err) {
    process.stderr.write(`[yessir] ${(err as Error).message ?? String(err)}\n`);
    return 1;
  }
}

async function runInitCmd(args: ParsedArgs): Promise<number> {
  const res = runInit({
    cwd: process.cwd(),
    force: Boolean(args.flags['force']),
    installClaudeHook: Boolean(args.flags['hook'])
  });
  for (const m of res.messages) process.stdout.write(m + '\n');
  process.stdout.write(
    res.policyCreated
      ? 'Next: run `yessir doctor` and then start Claude Code as usual.\n'
      : 'Policy unchanged. Use --force to overwrite.\n'
  );
  return 0;
}

async function runHookCmd(): Promise<number> {
  const input = await readAllStdin();
  const res = runHookOnce({ cwd: process.cwd(), input });
  process.stdout.write(res.output);
  if (!res.output.endsWith('\n')) process.stdout.write('\n');
  return res.exitCode;
}

async function runExplainCmd(args: ParsedArgs): Promise<number> {
  const command = args.positional.slice(1).join(' ').trim();
  if (!command) {
    process.stderr.write('yessir explain <command>\n');
    return 64;
  }
  const res = runExplain({
    cwd: process.cwd(),
    command,
    provider: pickProvider(args) ?? 'claude',
    policyPath: typeof args.flags['policy'] === 'string' ? args.flags['policy'] : undefined
  });
  const loc = res.policyPath ? res.policyPath : '(default policy)';
  process.stdout.write(`Command: ${command}\n`);
  process.stdout.write(`Policy:  ${loc} (mode=${res.policy.mode})\n`);
  process.stdout.write(`Decision: ${res.decision.type.toUpperCase()}\n`);
  if (res.decision.rule) process.stdout.write(`Rule:     ${res.decision.rule}\n`);
  process.stdout.write(`Reason:   ${res.decision.reason}\n`);
  return 0;
}

async function runDoctorCmd(): Promise<number> {
  const report = runDoctor({ cwd: process.cwd() });
  for (const check of report.checks) {
    const icon = check.status === 'ok' ? '[ok]  ' : check.status === 'warn' ? '[warn]' : '[err] ';
    process.stdout.write(`${icon} ${check.name}: ${check.details}\n`);
  }
  return report.ok ? 0 : 1;
}

async function runProviderCmd(provider: Provider, args: ParsedArgs): Promise<number> {
  return runWrap({
    cwd: process.cwd(),
    provider,
    mode: readMode(args),
    dryRun: Boolean(args.flags['dry-run']),
    noAi: Boolean(args.flags['no-ai']),
    logLevel: readLogLevel(args)
  });
}

async function runCustomCmd(args: ParsedArgs): Promise<number> {
  const [command, ...rest] = args.passthrough;
  if (!command) {
    process.stderr.write('yessir -- <command> [args...]\n');
    return 64;
  }
  return runWrap({
    cwd: process.cwd(),
    provider: 'generic',
    command,
    args: rest,
    mode: readMode(args),
    dryRun: Boolean(args.flags['dry-run']),
    noAi: Boolean(args.flags['no-ai']),
    logLevel: readLogLevel(args)
  });
}

function readMode(args: ParsedArgs): Mode | undefined {
  const val = args.flags['mode'];
  if (typeof val !== 'string') return undefined;
  if (val === 'quick' || val === 'ai' || val === 'hybrid') return val;
  throw new Error(`invalid --mode value: ${val} (expected quick|ai|hybrid)`);
}

function readLogLevel(args: ParsedArgs): 'debug' | 'info' | 'warn' | 'error' | undefined {
  const val = args.flags['log-level'];
  if (typeof val !== 'string') return undefined;
  if (val === 'debug' || val === 'info' || val === 'warn' || val === 'error') return val;
  throw new Error(`invalid --log-level value: ${val}`);
}

function pickProvider(args: ParsedArgs): Provider | null {
  const val = args.flags['provider'];
  if (typeof val !== 'string') return null;
  if (val === 'claude' || val === 'codex' || val === 'gemini' || val === 'aider' || val === 'generic') return val;
  throw new Error(`invalid --provider value: ${val}`);
}

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const positional: string[] = [];
  const passthrough: string[] = [];
  const flags: Record<string, string | boolean> = {};
  let afterDoubleDash = false;
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i] ?? '';
    if (afterDoubleDash) {
      passthrough.push(token);
      continue;
    }
    if (token === '--') {
      afterDoubleDash = true;
      continue;
    }
    if (token.startsWith('--')) {
      const eq = token.indexOf('=');
      if (eq >= 0) {
        flags[token.slice(2, eq)] = token.slice(eq + 1);
      } else {
        const key = token.slice(2);
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith('--') && !isKnownBooleanFlag(key)) {
          flags[key] = next;
          i += 1;
        } else {
          flags[key] = true;
        }
      }
    } else if (token.startsWith('-') && token.length > 1) {
      flags[token.slice(1)] = true;
    } else {
      positional.push(token);
    }
  }
  return {
    command: positional[0] ?? null,
    positional,
    passthrough,
    flags
  };
}

function isKnownBooleanFlag(name: string): boolean {
  return ['force', 'hook', 'dry-run', 'no-ai', 'help', 'version', 'h', 'v'].includes(name);
}

function readAllStdin(): Promise<string> {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) {
      resolve('');
      return;
    }
    const chunks: Buffer[] = [];
    process.stdin.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    process.stdin.on('error', () => resolve(''));
  });
}
