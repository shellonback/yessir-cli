import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const PROJECT_SETTINGS_REL = path.join('.claude', 'settings.json');
const GLOBAL_SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json');

export interface ToggleOptions {
  cwd: string;
  scope?: 'project' | 'global';
  /** Override settings path (used by tests). */
  settingsPath?: string;
}

export interface ToggleResult {
  settingsPath: string;
  status: 'off' | 'on' | 'no-change' | 'no-settings';
  messages: string[];
}

function resolveSettingsPath(opts: ToggleOptions): string {
  if (opts.settingsPath) return opts.settingsPath;
  if (opts.scope === 'global') return GLOBAL_SETTINGS_PATH;
  return path.join(path.resolve(opts.cwd), PROJECT_SETTINGS_REL);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function isYessirHookCommand(cmd: unknown): boolean {
  if (typeof cmd !== 'string') return false;
  return /(^|\s|\/)yessir(-cli)?\s+hook\b/.test(cmd);
}

function stripYessirEntries(preToolUse: unknown): { next: unknown[]; removed: number } {
  if (!Array.isArray(preToolUse)) return { next: [], removed: 0 };
  let removed = 0;
  const next: unknown[] = [];
  for (const entry of preToolUse) {
    if (!isRecord(entry)) {
      next.push(entry);
      continue;
    }
    const handlers = Array.isArray(entry.hooks) ? entry.hooks : [];
    const survivors = handlers.filter(
      (h) => !(isRecord(h) && isYessirHookCommand(h.command))
    );
    const removedHere = handlers.length - survivors.length;
    if (removedHere === 0) {
      next.push(entry);
      continue;
    }
    removed += removedHere;
    if (survivors.length > 0) {
      next.push({ ...entry, hooks: survivors });
    }
    // else drop the whole entry: it only had the yessir hook
  }
  return { next, removed };
}

/**
 * Remove every yessir `PreToolUse` hook from the target settings.json.
 *
 * Claude Code re-reads this file between tool calls, so in practice yessir
 * stops being operative almost immediately — the next tool call no longer
 * invokes `yessir hook` and Claude's native permission flow kicks back in.
 *
 * The change is reversible: `yessir on` (or `yessir init --hook`) re-adds it.
 */
export function turnOff(opts: ToggleOptions): ToggleResult {
  const settingsPath = resolveSettingsPath(opts);
  const messages: string[] = [];
  if (!fs.existsSync(settingsPath)) {
    messages.push(`no settings file at ${settingsPath} — nothing to disable`);
    return { settingsPath, status: 'no-settings', messages };
  }
  let current: Record<string, unknown> = {};
  try {
    const raw = fs.readFileSync(settingsPath, 'utf8');
    const parsed = raw.trim().length === 0 ? {} : JSON.parse(raw);
    if (!isRecord(parsed)) {
      messages.push(`refusing to rewrite ${settingsPath}: top-level value is not an object`);
      return { settingsPath, status: 'no-change', messages };
    }
    current = parsed;
  } catch (err) {
    messages.push(`refusing to rewrite ${settingsPath}: invalid JSON (${(err as Error).message})`);
    return { settingsPath, status: 'no-change', messages };
  }

  const hooks = isRecord(current.hooks) ? { ...current.hooks } : {};
  const preToolUse = Array.isArray(hooks.PreToolUse) ? hooks.PreToolUse : [];
  const { next, removed } = stripYessirEntries(preToolUse);
  if (removed === 0) {
    messages.push(`no yessir hook found in ${settingsPath} — already off`);
    return { settingsPath, status: 'no-change', messages };
  }
  if (next.length === 0) {
    delete hooks.PreToolUse;
  } else {
    hooks.PreToolUse = next;
  }
  if (Object.keys(hooks).length === 0) {
    delete current.hooks;
  } else {
    current.hooks = hooks;
  }
  fs.writeFileSync(settingsPath, JSON.stringify(current, null, 2) + '\n', 'utf8');
  messages.push(
    `yessir is now OFF: removed ${removed} hook entr${removed === 1 ? 'y' : 'ies'} from ${settingsPath}`
  );
  messages.push('Run `yessir on` to re-enable.');
  return { settingsPath, status: 'off', messages };
}

/**
 * Re-install the yessir PreToolUse hook. Thin delegator over installClaudeHook
 * from commands/init, kept here so the CLI surface stays symmetrical.
 */
export function turnOn(opts: ToggleOptions, installer: (p: {
  cwd: string;
  settingsPath?: string;
}) => { installed: boolean; messages: string[] }): ToggleResult {
  const settingsPath = resolveSettingsPath(opts);
  const res = installer({ cwd: opts.cwd, settingsPath });
  return {
    settingsPath,
    status: res.installed ? 'on' : 'no-change',
    messages: res.messages
  };
}

// Exported for tests.
export const __internal = { stripYessirEntries, isYessirHookCommand };
