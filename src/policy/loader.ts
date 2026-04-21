import * as fs from 'fs';
import * as path from 'path';
import { parseYaml, YamlParseError } from './yaml';
import type { Mode, Policy } from '../types';

export const DEFAULT_POLICY: Policy = {
  mode: 'hybrid',
  allow: {
    commands: [
      'git status',
      'git diff',
      'git diff *',
      'git log',
      'git log *',
      'git show *',
      'git branch',
      'npm test',
      'npm run test',
      'npm run test *',
      'npm run lint',
      'npm run build',
      'pnpm test',
      'pnpm lint',
      'pnpm build',
      'yarn test',
      'yarn lint',
      'yarn build',
      'ls',
      'ls *',
      'pwd',
      'node --version',
      'npm --version'
    ],
    read: ['**/*'],
    write: ['src/**', 'app/**', 'lib/**', 'tests/**', 'test/**', 'docs/**', 'README.md']
  },
  deny: {
    commands: [
      'rm -rf *',
      'rm -fr *',
      'rm -rf /',
      'sudo *',
      'git push --force *',
      'git push -f *',
      'curl * | bash',
      'curl * | sh',
      'wget * | bash',
      'wget * | sh',
      'npm publish',
      'npm publish *',
      'pnpm publish',
      'pnpm publish *',
      'yarn publish',
      'yarn publish *',
      'chmod -R 777 *',
      'mkfs *',
      'dd *'
    ]
  },
  requireManual: {
    commands: [
      'git push',
      'git push *',
      'git tag *',
      'git reset --hard',
      'git reset --hard *',
      'git clean -fd',
      'git clean -fd *',
      'docker compose up *',
      'docker compose down',
      'docker compose down *',
      'npm install',
      'npm install *',
      'pnpm install',
      'pnpm install *',
      'yarn install',
      'yarn install *',
      'brew install *',
      'apt install *',
      'apt-get install *'
    ]
  },
  aiReply: {
    enabled: true,
    model: 'auto',
    maxTailLines: 300,
    requireManualOn: ['secrets', 'deployment', 'destructive_command', 'external_network_script']
  }
};

export const POLICY_RELATIVE_PATH = path.join('.yessir', 'yessir.yml');

export class PolicyLoadError extends Error {
  override readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'PolicyLoadError';
    this.cause = cause;
  }
}

export function findPolicyFile(startDir: string): string | null {
  let dir = path.resolve(startDir);
  const root = path.parse(dir).root;
  while (true) {
    const candidate = path.join(dir, POLICY_RELATIVE_PATH);
    if (fs.existsSync(candidate)) return candidate;
    if (dir === root) return null;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function loadPolicy(filePath: string): Policy {
  let contents: string;
  try {
    contents = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    throw new PolicyLoadError(`cannot read policy file: ${filePath}`, err);
  }
  return parsePolicy(contents);
}

export function parsePolicy(contents: string): Policy {
  let raw: unknown;
  try {
    raw = parseYaml(contents);
  } catch (err) {
    if (err instanceof YamlParseError) {
      throw new PolicyLoadError(err.message, err);
    }
    throw new PolicyLoadError('failed to parse policy YAML', err);
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new PolicyLoadError('policy root must be a mapping');
  }
  const obj = raw as Record<string, unknown>;
  const mode = parseMode(obj.mode);
  const allow = parseAllow(obj.allow);
  const deny = parseDeny(obj.deny);
  const requireManual = parseRequireManual(obj.require_manual);
  const aiReply = parseAiReply(obj.ai_reply);
  return { mode, allow, deny, requireManual, aiReply };
}

function parseMode(value: unknown): Mode {
  if (value === undefined || value === '') return DEFAULT_POLICY.mode;
  if (value === 'quick' || value === 'ai' || value === 'hybrid') return value;
  throw new PolicyLoadError(`invalid mode: ${JSON.stringify(value)} (expected quick|ai|hybrid)`);
}

function parseStringList(value: unknown, key: string): string[] {
  if (value === undefined || value === '') return [];
  if (!Array.isArray(value)) {
    throw new PolicyLoadError(`${key} must be a list of strings`);
  }
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') {
      throw new PolicyLoadError(`${key} entries must be strings (got ${typeof item})`);
    }
    const trimmed = item.trim();
    if (trimmed.length === 0) continue;
    out.push(trimmed);
  }
  return out;
}

function parseAllow(value: unknown): Policy['allow'] {
  if (value === undefined || value === '') {
    return { commands: [], read: [], write: [] };
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new PolicyLoadError('allow must be a mapping');
  }
  const obj = value as Record<string, unknown>;
  return {
    commands: parseStringList(obj.commands, 'allow.commands'),
    read: parseStringList(obj.read, 'allow.read'),
    write: parseStringList(obj.write, 'allow.write')
  };
}

function parseDeny(value: unknown): Policy['deny'] {
  if (value === undefined || value === '') return { commands: [] };
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new PolicyLoadError('deny must be a mapping');
  }
  const obj = value as Record<string, unknown>;
  return { commands: parseStringList(obj.commands, 'deny.commands') };
}

function parseRequireManual(value: unknown): Policy['requireManual'] {
  if (value === undefined || value === '') return { commands: [] };
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new PolicyLoadError('require_manual must be a mapping');
  }
  const obj = value as Record<string, unknown>;
  return { commands: parseStringList(obj.commands, 'require_manual.commands') };
}

function parseAiReply(value: unknown): Policy['aiReply'] {
  if (value === undefined || value === '') {
    return { ...DEFAULT_POLICY.aiReply };
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new PolicyLoadError('ai_reply must be a mapping');
  }
  const obj = value as Record<string, unknown>;
  const enabled = obj.enabled === undefined ? DEFAULT_POLICY.aiReply.enabled : Boolean(obj.enabled);
  const model = obj.model === undefined || obj.model === '' ? 'auto' : String(obj.model);
  const maxTailLinesRaw = obj.max_tail_lines;
  let maxTailLines = DEFAULT_POLICY.aiReply.maxTailLines;
  if (maxTailLinesRaw !== undefined && maxTailLinesRaw !== '') {
    if (typeof maxTailLinesRaw !== 'number' || !Number.isFinite(maxTailLinesRaw) || maxTailLinesRaw <= 0) {
      throw new PolicyLoadError('ai_reply.max_tail_lines must be a positive number');
    }
    maxTailLines = Math.floor(maxTailLinesRaw);
  }
  const requireManualOn = parseStringList(obj.require_manual_on, 'ai_reply.require_manual_on');
  return { enabled, model, maxTailLines, requireManualOn };
}
