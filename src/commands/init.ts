import * as fs from 'fs';
import * as path from 'path';

const TEMPLATE_CANDIDATES = [
  path.join('..', '..', 'templates', 'yessir.yml'),
  path.join('..', '..', '..', 'templates', 'yessir.yml')
];
const YESSIR_DIR = '.yessir';
const POLICY_FILE = 'yessir.yml';
const LOG_FILE = 'yessir.log';

export interface InitOptions {
  cwd: string;
  force?: boolean;
  installClaudeHook?: boolean;
  claudeSettingsPath?: string;
}

export interface InitResult {
  policyPath: string;
  logPath: string;
  policyCreated: boolean;
  hookInstalled: boolean;
  messages: string[];
}

export function runInit(opts: InitOptions): InitResult {
  const cwd = path.resolve(opts.cwd);
  const yessirDir = path.join(cwd, YESSIR_DIR);
  const policyPath = path.join(yessirDir, POLICY_FILE);
  const logPath = path.join(yessirDir, LOG_FILE);
  const messages: string[] = [];

  fs.mkdirSync(yessirDir, { recursive: true });

  let policyCreated = false;
  if (fs.existsSync(policyPath) && !opts.force) {
    messages.push(`policy already exists at ${relativeTo(cwd, policyPath)} (use --force to overwrite)`);
  } else {
    const template = readTemplate();
    fs.writeFileSync(policyPath, template, { encoding: 'utf8', flag: opts.force ? 'w' : 'wx' });
    policyCreated = true;
    messages.push(`wrote policy to ${relativeTo(cwd, policyPath)}`);
  }

  // Make sure the log file exists so that later appends do not race on
  // mkdirp; also keeps `doctor` introspection simple.
  if (!fs.existsSync(logPath)) {
    fs.writeFileSync(logPath, '', { encoding: 'utf8' });
    messages.push(`created empty log at ${relativeTo(cwd, logPath)}`);
  }

  let hookInstalled = false;
  if (opts.installClaudeHook) {
    const res = installClaudeHook({
      cwd,
      settingsPath: opts.claudeSettingsPath
    });
    hookInstalled = res.installed;
    messages.push(...res.messages);
  }

  return { policyPath, logPath, policyCreated, hookInstalled, messages };
}

function readTemplate(): string {
  for (const rel of TEMPLATE_CANDIDATES) {
    const p = path.resolve(__dirname, rel);
    if (fs.existsSync(p)) {
      return fs.readFileSync(p, 'utf8');
    }
  }
  throw new Error(
    'template yessir.yml not found; expected under one of: ' +
      TEMPLATE_CANDIDATES.map((r) => path.resolve(__dirname, r)).join(', ')
  );
}

function relativeTo(cwd: string, target: string): string {
  const rel = path.relative(cwd, target);
  return rel && !rel.startsWith('..') ? rel : target;
}

interface HookInstallResult {
  installed: boolean;
  messages: string[];
}

interface HookInstallOptions {
  cwd: string;
  settingsPath?: string;
}

const HOOK_MATCHER = 'Bash|Write|Edit|MultiEdit|NotebookEdit';

/**
 * Wires `.claude/settings.json` so Claude Code calls `yessir hook` on
 * every PreToolUse event. Because settings live in the project directory,
 * they take effect the next time Claude Code reads them — which it does at
 * session start and on hot-reload, so active sessions pick the change up
 * immediately on their next tool invocation.
 */
export function installClaudeHook(opts: HookInstallOptions): HookInstallResult {
  const messages: string[] = [];
  const settingsPath =
    opts.settingsPath ?? path.join(opts.cwd, '.claude', 'settings.json');
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });

  let current: Record<string, unknown> = {};
  if (fs.existsSync(settingsPath)) {
    try {
      const raw = fs.readFileSync(settingsPath, 'utf8');
      const parsed = raw.trim().length === 0 ? {} : JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        current = parsed as Record<string, unknown>;
      }
    } catch (err) {
      messages.push(
        `refusing to modify ${settingsPath}: invalid JSON (${(err as Error).message})`
      );
      return { installed: false, messages };
    }
  }

  const hooks = isRecord(current.hooks) ? { ...current.hooks } : {};
  const preToolUse = Array.isArray(hooks.PreToolUse) ? [...hooks.PreToolUse] : [];
  const already = preToolUse.some((entry) => {
    if (!isRecord(entry)) return false;
    const handlers = Array.isArray(entry.hooks) ? entry.hooks : [];
    return handlers.some(
      (h) => isRecord(h) && typeof h.command === 'string' && /yessir\s+hook/.test(h.command)
    );
  });

  if (already) {
    messages.push(`yessir hook already present in ${settingsPath}`);
    return { installed: false, messages };
  }

  preToolUse.push({
    matcher: HOOK_MATCHER,
    hooks: [
      {
        type: 'command',
        command: 'yessir hook'
      }
    ]
  });
  hooks.PreToolUse = preToolUse;
  current.hooks = hooks;

  fs.writeFileSync(settingsPath, JSON.stringify(current, null, 2) + '\n', 'utf8');
  messages.push(`installed PreToolUse hook in ${settingsPath}`);
  return { installed: true, messages };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
