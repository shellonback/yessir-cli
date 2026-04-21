import * as fs from 'fs';
import * as path from 'path';

const LOG_RELATIVE_PATH = path.join('.yessir', 'yessir.log');
const DEFAULT_LINES = 50;
const TAIL_POLL_MS = 500;
const MAX_INITIAL_BYTES = 256 * 1024;

export interface TailOptions {
  cwd: string;
  follow?: boolean;
  lines?: number;
  raw?: boolean;
  color?: boolean;
  stdout?: NodeJS.WritableStream;
  /** Explicit log file path; skips the ancestor walk-up when provided. */
  logPath?: string;
  /** Optional stop signal; when fired the follow loop exits cleanly. */
  signal?: AbortSignal;
}

type Formatter = (line: string) => string;

export interface TailResult {
  linesEmitted: number;
  stopped: 'signal' | 'no-follow' | 'error';
}

/**
 * Live pretty-tail of the decision log.
 *
 * Walks up from cwd to find the nearest `.yessir/yessir.log`. Prints the
 * last `lines` entries, and if `follow` is true keeps streaming new ones
 * as they arrive (poll-based — more robust across filesystems than
 * fs.watch, which misbehaves on atomic rename/truncate on macOS).
 */
export async function runTail(opts: TailOptions): Promise<TailResult> {
  const out = opts.stdout ?? process.stdout;
  const logPath = opts.logPath ?? findLogFile(opts.cwd);
  if (!logPath || !fs.existsSync(logPath)) {
    out.write(
      `[yessir] no log found. Run \`yessir init\` to create .yessir/yessir.log.\n`
    );
    return { linesEmitted: 0, stopped: 'error' };
  }
  const useColor = opts.color ?? isTty(out);
  const raw = opts.raw === true;
  const formatter: Formatter = raw ? (l) => l : (l) => prettyLine(l, useColor);
  const lines = Math.max(0, opts.lines ?? DEFAULT_LINES);

  let offset = 0;
  const stat = safeStat(logPath);
  if (stat) {
    const start = Math.max(0, stat.size - MAX_INITIAL_BYTES);
    const initialSlice = readRange(logPath, start, stat.size);
    const initialLines = splitLines(initialSlice);
    // If we sliced mid-line (start > 0), drop the first partial.
    const normalized = start > 0 ? initialLines.slice(1) : initialLines;
    const tail = lines > 0 ? normalized.slice(-lines) : [];
    for (const line of tail) out.write(formatter(line) + '\n');
    offset = stat.size;
  } else {
    offset = 0;
  }

  if (!opts.follow) {
    return { linesEmitted: 0, stopped: 'no-follow' };
  }

  out.write(colorize(`[yessir] watching ${logPath} (Ctrl+C to stop)\n`, useColor, '2'));

  return new Promise<TailResult>((resolve) => {
    let buffer = '';
    let stopped = false;
    const stop = (why: TailResult['stopped']) => {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      if (opts.signal && opts.signal.aborted === false) {
        opts.signal.removeEventListener('abort', onAbort);
      }
      resolve({ linesEmitted: 0, stopped: why });
    };
    const onAbort = () => stop('signal');
    if (opts.signal) {
      if (opts.signal.aborted) {
        stop('signal');
        return;
      }
      opts.signal.addEventListener('abort', onAbort, { once: true });
    }
    const timer = setInterval(() => {
      if (stopped) return;
      const s = safeStat(logPath);
      if (!s) return;
      if (s.size < offset) {
        // Log was rotated/truncated under us; reset.
        offset = 0;
        buffer = '';
      }
      if (s.size === offset) return;
      const chunk = readRange(logPath, offset, s.size);
      offset = s.size;
      buffer += chunk;
      const parts = buffer.split('\n');
      buffer = parts.pop() ?? '';
      for (const line of parts) {
        if (line.length === 0) continue;
        out.write(formatter(line) + '\n');
      }
    }, TAIL_POLL_MS);
  });
}

export function findLogFile(startDir: string): string | null {
  let dir = path.resolve(startDir);
  const root = path.parse(dir).root;
  while (true) {
    const candidate = path.join(dir, LOG_RELATIVE_PATH);
    if (fs.existsSync(candidate)) return candidate;
    if (dir === root) return null;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function safeStat(file: string): fs.Stats | null {
  try {
    return fs.statSync(file);
  } catch {
    return null;
  }
}

function readRange(file: string, start: number, end: number): string {
  if (end <= start) return '';
  const fd = fs.openSync(file, 'r');
  try {
    const length = end - start;
    const buf = Buffer.allocUnsafe(length);
    fs.readSync(fd, buf, 0, length, start);
    return buf.toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

function splitLines(input: string): string[] {
  if (input.length === 0) return [];
  return input.split('\n').filter((l) => l.length > 0);
}

function isTty(stream: NodeJS.WritableStream): boolean {
  return Boolean((stream as { isTTY?: boolean }).isTTY);
}

const RESET = '[0m';
const ANSI = {
  dim: '[2m',
  bold: '[1m',
  red: '[31m',
  green: '[32m',
  yellow: '[33m',
  blue: '[34m',
  magenta: '[35m',
  cyan: '[36m',
  gray: '[90m'
};

function colorize(text: string, enable: boolean, code: string): string {
  if (!enable) return text;
  return `[${code}m${text}${RESET}`;
}

function paint(text: string, enable: boolean, color: keyof typeof ANSI): string {
  if (!enable) return text;
  return `${ANSI[color]}${text}${RESET}`;
}

export function prettyLine(rawLine: string, useColor: boolean): string {
  const line = rawLine.trim();
  if (!line) return '';
  // Legacy plain-text lines written by the hook (timestamp tool -> decision ...).
  if (!line.startsWith('{')) return paint(line, useColor, 'gray');

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return paint(line, useColor, 'gray');
  }

  const ts = String(parsed.ts ?? '');
  const time = ts.length >= 19 ? ts.slice(11, 19) : ts;
  const event = String(parsed.event ?? '');
  const level = String(parsed.level ?? 'info');

  if (event === 'hook.decision') {
    const tool = String(parsed.tool ?? '-');
    const decision = String(parsed.decision ?? 'passthrough');
    const reason = String(parsed.reason ?? '');
    const { icon, color, label } = describeDecision(decision);
    const left = `${paint(time, useColor, 'gray')} ${paint(pad(tool, 6), useColor, 'cyan')}`;
    const mid = `${icon} ${paint(pad(label, 7), useColor, color)}`;
    const right = reason ? paint(reason, useColor, 'gray') : '';
    return `${left}  ${mid}  ${right}`.trimEnd();
  }

  if (event === 'run.decision' || event === 'run.ai_decision') {
    const kind = String(parsed.kind ?? parsed.type ?? '-');
    const decision = String(parsed.type ?? parsed.decision ?? '-');
    const reason = String(parsed.reason ?? '');
    const { icon, color, label } = describeDecision(decision);
    return (
      `${paint(time, useColor, 'gray')} ${paint(pad(kind, 6), useColor, 'cyan')}  ` +
      `${icon} ${paint(pad(label, 7), useColor, color)}  ` +
      paint(reason, useColor, 'gray')
    ).trimEnd();
  }

  // Generic event line — warn / error / info with remaining fields.
  const { icon, color } = describeLevel(level);
  const rest = Object.entries(parsed)
    .filter(([k]) => k !== 'ts' && k !== 'level' && k !== 'event')
    .map(([k, v]) => `${k}=${formatValue(v)}`)
    .join(' ');
  return (
    `${paint(time, useColor, 'gray')} ${icon} ${paint(event, useColor, color)}` +
    (rest ? '  ' + paint(rest, useColor, 'gray') : '')
  );
}

function describeDecision(decision: string): {
  icon: string;
  color: keyof typeof ANSI;
  label: string;
} {
  switch (decision) {
    case 'approve':
      return { icon: '✅', color: 'green', label: 'APPROVE' };
    case 'deny':
    case 'block':
      return { icon: '⛔', color: 'red', label: 'BLOCK' };
    case 'ask_ai':
      return { icon: '🤖', color: 'magenta', label: 'ASK_AI' };
    case 'manual':
    case 'ask':
    case 'passthrough':
      return { icon: '🙋', color: 'yellow', label: 'ASK' };
    default:
      return { icon: '·', color: 'gray', label: decision.toUpperCase() };
  }
}

function describeLevel(level: string): { icon: string; color: keyof typeof ANSI } {
  switch (level) {
    case 'error':
      return { icon: '✖', color: 'red' };
    case 'warn':
      return { icon: '⚠', color: 'yellow' };
    case 'debug':
      return { icon: '·', color: 'gray' };
    case 'info':
    default:
      return { icon: 'ⓘ', color: 'blue' };
  }
}

function pad(s: string, width: number): string {
  return s.length >= width ? s : s + ' '.repeat(width - s.length);
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return '-';
  if (typeof v === 'string') return v.length > 80 ? v.slice(0, 77) + '...' : v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
