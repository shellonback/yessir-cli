import * as fs from 'fs';
import * as path from 'path';
import { findPolicyFile, loadPolicy } from '../policy/loader';

export interface DoctorOptions {
  cwd: string;
}

export interface DoctorCheck {
  name: string;
  status: 'ok' | 'warn' | 'error';
  details: string;
}

export interface DoctorReport {
  checks: DoctorCheck[];
  ok: boolean;
}

export function runDoctor(opts: DoctorOptions): DoctorReport {
  const cwd = path.resolve(opts.cwd);
  const checks: DoctorCheck[] = [];

  const nodeVersion = process.versions.node;
  const major = Number(nodeVersion.split('.')[0] ?? 0);
  checks.push({
    name: 'node',
    status: major >= 18 ? 'ok' : 'error',
    details: `detected node ${nodeVersion} (require >= 18.17)`
  });

  const policyPath = findPolicyFile(cwd);
  if (!policyPath) {
    checks.push({
      name: 'policy',
      status: 'warn',
      details: `no .yessir/yessir.yml found starting from ${cwd}. Run \`yessir init\`.`
    });
  } else {
    try {
      const policy = loadPolicy(policyPath);
      const totalRules =
        policy.allow.commands.length +
        policy.deny.commands.length +
        policy.requireManual.commands.length;
      const overlyBroad = policy.allow.commands.filter((p) => p === '*' || p === '**').length;
      checks.push({
        name: 'policy',
        status: overlyBroad > 0 ? 'warn' : 'ok',
        details: `${policyPath}: mode=${policy.mode}, rules=${totalRules}${
          overlyBroad > 0 ? `, ${overlyBroad} overly broad allow rules detected` : ''
        }`
      });
    } catch (err) {
      checks.push({
        name: 'policy',
        status: 'error',
        details: `${policyPath}: ${(err as Error).message}`
      });
    }
  }

  checks.push({
    name: 'node-pty',
    status: isNodePtyAvailable() ? 'ok' : 'warn',
    details: isNodePtyAvailable()
      ? 'node-pty is installed; PTY wrapper mode available'
      : 'node-pty not installed. Install it to enable `yessir claude` wrapping.'
  });

  const settingsPath = path.join(cwd, '.claude', 'settings.json');
  if (fs.existsSync(settingsPath)) {
    try {
      const raw = fs.readFileSync(settingsPath, 'utf8');
      const parsed = JSON.parse(raw);
      const hasHook =
        parsed &&
        typeof parsed === 'object' &&
        parsed.hooks &&
        Array.isArray(parsed.hooks.PreToolUse) &&
        parsed.hooks.PreToolUse.some((entry: unknown) => JSON.stringify(entry).includes('yessir hook'));
      checks.push({
        name: 'claude-hook',
        status: hasHook ? 'ok' : 'warn',
        details: hasHook
          ? `PreToolUse hook present in ${settingsPath}`
          : `no yessir hook wired in ${settingsPath}. Run \`yessir init --hook\` to install.`
      });
    } catch (err) {
      checks.push({
        name: 'claude-hook',
        status: 'error',
        details: `${settingsPath}: ${(err as Error).message}`
      });
    }
  } else {
    checks.push({
      name: 'claude-hook',
      status: 'warn',
      details: `no ${settingsPath}; autoapprove via hook requires Claude Code settings.`
    });
  }

  const ok = checks.every((c) => c.status !== 'error');
  return { checks, ok };
}

function isNodePtyAvailable(): boolean {
  try {
    require.resolve('node-pty');
    return true;
  } catch {
    return false;
  }
}
