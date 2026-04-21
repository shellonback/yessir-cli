import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { hookInputToPrompt, processHookInput } from '../src/hook/pretooluse';
import { runHookOnce } from '../src/commands/hook';
import { DEFAULT_POLICY } from '../src/policy/loader';

test('hookInputToPrompt maps Bash tool to command prompt', () => {
  const p = hookInputToPrompt({
    tool_name: 'Bash',
    tool_input: { command: 'npm test' }
  });
  assert.equal(p.kind, 'command');
  assert.equal(p.command, 'npm test');
});

test('hookInputToPrompt maps Write tool to file_write prompt', () => {
  const p = hookInputToPrompt({
    tool_name: 'Write',
    tool_input: { file_path: 'src/app.ts', content: '...' }
  });
  assert.equal(p.kind, 'file_write');
  assert.equal(p.target, 'src/app.ts');
});

test('processHookInput approves safe command', () => {
  const out = processHookInput(
    { tool_name: 'Bash', tool_input: { command: 'npm test' } },
    { cwd: '/tmp', policy: DEFAULT_POLICY }
  );
  assert.equal(out.decision, 'approve');
  const hookOut = (out.hookSpecificOutput ?? {}) as Record<string, unknown>;
  assert.equal(hookOut.permissionDecision, 'allow');
});

test('processHookInput blocks denylisted command', () => {
  const out = processHookInput(
    { tool_name: 'Bash', tool_input: { command: 'rm -rf /' } },
    { cwd: '/tmp', policy: DEFAULT_POLICY }
  );
  assert.equal(out.decision, 'block');
  const hookOut = (out.hookSpecificOutput ?? {}) as Record<string, unknown>;
  assert.equal(hookOut.permissionDecision, 'deny');
});

test('processHookInput passes unknown through to user when allow list is empty', () => {
  const strictPolicy = {
    ...DEFAULT_POLICY,
    mode: 'quick' as const,
    allow: { commands: [], read: [], write: [] },
    aiReply: { ...DEFAULT_POLICY.aiReply, enabled: false }
  };
  const out = processHookInput(
    { tool_name: 'Bash', tool_input: { command: 'some-rare-tool --flag' } },
    { cwd: '/tmp', policy: strictPolicy }
  );
  assert.equal(out.continue, true);
  assert.notEqual(out.decision, 'approve');
});

test('processHookInput handles missing tool_name', () => {
  const out = processHookInput({} as never, { cwd: '/tmp', policy: DEFAULT_POLICY });
  assert.equal(out.continue, true);
  assert.notEqual(out.decision, 'approve');
});

test('runHookOnce emits JSON on stdout and never throws on bad JSON', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'paa-badjson-'));
  const res = runHookOnce({ cwd: tmp, input: '{bad json' });
  const parsed = JSON.parse(res.output);
  assert.equal(parsed.continue, true);
  assert.match(parsed.reason, /invalid JSON/);
});

test('runHookOnce loads policy from nearest .yessir folder', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'paa-hook-'));
  fs.mkdirSync(path.join(tmp, '.yessir'), { recursive: true });
  fs.writeFileSync(
    path.join(tmp, '.yessir', 'yessir.yml'),
    'mode: quick\nallow:\n  commands:\n    - git status\n'
  );
  const input = JSON.stringify({
    tool_name: 'Bash',
    tool_input: { command: 'git status' }
  });
  const res = runHookOnce({ cwd: tmp, input });
  const parsed = JSON.parse(res.output);
  assert.equal(parsed.decision, 'approve');
});

test('runHookOnce escalates on invalid policy file', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'paa-bad-'));
  fs.mkdirSync(path.join(tmp, '.yessir'), { recursive: true });
  fs.writeFileSync(path.join(tmp, '.yessir', 'yessir.yml'), 'mode: turbo\n');
  const input = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git status' } });
  const res = runHookOnce({ cwd: tmp, input });
  const parsed = JSON.parse(res.output);
  assert.equal(parsed.continue, true);
  assert.notEqual(parsed.decision, 'approve');
});

test('runHookOnce handles empty stdin', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'paa-empty-'));
  const res = runHookOnce({ cwd: tmp, input: '' });
  const parsed = JSON.parse(res.output);
  assert.equal(parsed.continue, true);
});
