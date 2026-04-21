import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { runInit, installClaudeHook } from '../src/commands/init';
import { parsePolicy } from '../src/policy/loader';

test('runInit writes a valid policy file', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'paa-init-'));
  const res = runInit({ cwd: tmp });
  assert.equal(res.policyCreated, true);
  const contents = fs.readFileSync(res.policyPath, 'utf8');
  const parsed = parsePolicy(contents);
  assert.equal(parsed.mode, 'hybrid');
  assert.ok(parsed.allow.commands.length > 0);
});

test('runInit is idempotent without --force', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'paa-init2-'));
  const first = runInit({ cwd: tmp });
  assert.equal(first.policyCreated, true);
  const second = runInit({ cwd: tmp });
  assert.equal(second.policyCreated, false);
  assert.ok(second.messages.some((m) => /already exists/.test(m)));
});

test('runInit with --force overwrites existing policy', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'paa-init3-'));
  runInit({ cwd: tmp });
  fs.writeFileSync(path.join(tmp, '.yessir', 'yessir.yml'), 'mode: quick\n');
  const res = runInit({ cwd: tmp, force: true });
  assert.equal(res.policyCreated, true);
  const parsed = parsePolicy(fs.readFileSync(res.policyPath, 'utf8'));
  assert.equal(parsed.mode, 'hybrid');
});

test('installClaudeHook adds PreToolUse entry to empty settings', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'paa-hook-install-'));
  const settings = path.join(tmp, '.claude', 'settings.json');
  const res = installClaudeHook({ cwd: tmp, settingsPath: settings });
  assert.equal(res.installed, true);
  const parsed = JSON.parse(fs.readFileSync(settings, 'utf8'));
  assert.ok(Array.isArray(parsed.hooks.PreToolUse));
  assert.ok(parsed.hooks.PreToolUse.length === 1);
});

test('installClaudeHook preserves existing settings', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'paa-hook-merge-'));
  const settings = path.join(tmp, '.claude', 'settings.json');
  fs.mkdirSync(path.dirname(settings), { recursive: true });
  fs.writeFileSync(settings, JSON.stringify({ permissions: { deny: ['x'] } }, null, 2));
  installClaudeHook({ cwd: tmp, settingsPath: settings });
  const parsed = JSON.parse(fs.readFileSync(settings, 'utf8'));
  assert.deepEqual(parsed.permissions.deny, ['x']);
  assert.ok(parsed.hooks.PreToolUse[0].hooks[0].command.includes('yessir hook'));
});

test('installClaudeHook does not duplicate hook on re-install', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'paa-hook-dedup-'));
  const settings = path.join(tmp, '.claude', 'settings.json');
  installClaudeHook({ cwd: tmp, settingsPath: settings });
  const second = installClaudeHook({ cwd: tmp, settingsPath: settings });
  assert.equal(second.installed, false);
  const parsed = JSON.parse(fs.readFileSync(settings, 'utf8'));
  assert.equal(parsed.hooks.PreToolUse.length, 1);
});

test('installClaudeHook refuses to parse invalid JSON', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'paa-hook-bad-'));
  const settings = path.join(tmp, '.claude', 'settings.json');
  fs.mkdirSync(path.dirname(settings), { recursive: true });
  fs.writeFileSync(settings, '{not valid');
  const res = installClaudeHook({ cwd: tmp, settingsPath: settings });
  assert.equal(res.installed, false);
  assert.ok(res.messages.some((m) => /invalid JSON/.test(m)));
});
