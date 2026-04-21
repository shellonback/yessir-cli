import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { turnOff, turnOn } from '../src/commands/toggle';
import { installClaudeHook } from '../src/commands/init';

function seedSettingsWithYessirHook(dir: string, extra: Record<string, unknown> = {}): string {
  const settings = path.join(dir, '.claude', 'settings.json');
  fs.mkdirSync(path.dirname(settings), { recursive: true });
  fs.writeFileSync(
    settings,
    JSON.stringify(
      {
        ...extra,
        hooks: {
          PreToolUse: [
            {
              matcher: 'Bash|Write|Edit|MultiEdit|NotebookEdit',
              hooks: [
                { type: 'command', command: 'yessir hook' },
                { type: 'command', command: 'some-other-tool --foo' }
              ]
            },
            {
              matcher: 'Notebook',
              hooks: [{ type: 'command', command: 'unrelated-hook' }]
            }
          ]
        }
      },
      null,
      2
    )
  );
  return settings;
}

test('turnOff removes yessir hook entries but keeps unrelated handlers', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'yt-off-'));
  const settings = seedSettingsWithYessirHook(tmp);
  const res = turnOff({ cwd: tmp, settingsPath: settings });
  assert.equal(res.status, 'off');
  const parsed = JSON.parse(fs.readFileSync(settings, 'utf8'));
  const pre = parsed.hooks.PreToolUse as Array<{
    matcher: string;
    hooks: Array<{ command: string }>;
  }>;
  // First entry should keep only the non-yessir handler
  const first = pre.find((e) => e.matcher.startsWith('Bash'));
  if (!first) throw new Error('Bash entry missing');
  assert.equal(first.hooks.length, 1);
  assert.equal(first.hooks[0]?.command, 'some-other-tool --foo');
  const second = pre.find((e) => e.matcher === 'Notebook');
  if (!second) throw new Error('Notebook entry missing');
  assert.equal(second.hooks[0]?.command, 'unrelated-hook');
});

test('turnOff drops empty entries entirely', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'yt-off2-'));
  const settings = path.join(tmp, '.claude', 'settings.json');
  fs.mkdirSync(path.dirname(settings), { recursive: true });
  fs.writeFileSync(
    settings,
    JSON.stringify({
      hooks: {
        PreToolUse: [
          { matcher: 'Bash', hooks: [{ type: 'command', command: 'yessir-cli hook' }] }
        ]
      }
    })
  );
  const res = turnOff({ cwd: tmp, settingsPath: settings });
  assert.equal(res.status, 'off');
  const parsed = JSON.parse(fs.readFileSync(settings, 'utf8'));
  assert.equal(parsed.hooks, undefined);
});

test('turnOff is idempotent and reports no-change when nothing matches', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'yt-off3-'));
  const settings = path.join(tmp, '.claude', 'settings.json');
  fs.mkdirSync(path.dirname(settings), { recursive: true });
  fs.writeFileSync(settings, JSON.stringify({
    hooks: {
      PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'other-tool' }] }]
    }
  }));
  const res = turnOff({ cwd: tmp, settingsPath: settings });
  assert.equal(res.status, 'no-change');
});

test('turnOff on a missing settings.json reports no-settings', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'yt-off4-'));
  const settings = path.join(tmp, '.claude', 'settings.json');
  const res = turnOff({ cwd: tmp, settingsPath: settings });
  assert.equal(res.status, 'no-settings');
});

test('turnOff refuses to rewrite malformed JSON', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'yt-off5-'));
  const settings = path.join(tmp, '.claude', 'settings.json');
  fs.mkdirSync(path.dirname(settings), { recursive: true });
  fs.writeFileSync(settings, '{not valid');
  const res = turnOff({ cwd: tmp, settingsPath: settings });
  assert.equal(res.status, 'no-change');
  assert.ok(res.messages.some((m) => /invalid JSON/.test(m)));
});

test('turnOn re-installs the hook after turnOff', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'yt-toggle-'));
  const settings = seedSettingsWithYessirHook(tmp, { permissions: { deny: ['x'] } });
  turnOff({ cwd: tmp, settingsPath: settings });
  const afterOff = JSON.parse(fs.readFileSync(settings, 'utf8'));
  assert.ok(!JSON.stringify(afterOff).includes('yessir hook'));

  const res = turnOn({ cwd: tmp, settingsPath: settings }, installClaudeHook);
  assert.equal(res.status, 'on');
  const afterOn = JSON.parse(fs.readFileSync(settings, 'utf8'));
  assert.ok(JSON.stringify(afterOn).includes('yessir hook'));
  // Pre-existing permissions preserved across off → on
  assert.deepEqual(afterOn.permissions.deny, ['x']);
});

test('turnOff handles both `yessir hook` and `yessir-cli hook` command forms', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'yt-off6-'));
  const settings = path.join(tmp, '.claude', 'settings.json');
  fs.mkdirSync(path.dirname(settings), { recursive: true });
  fs.writeFileSync(
    settings,
    JSON.stringify({
      hooks: {
        PreToolUse: [
          { matcher: 'Bash', hooks: [{ type: 'command', command: 'yessir-cli hook' }] },
          { matcher: 'Edit', hooks: [{ type: 'command', command: '/usr/bin/yessir hook' }] }
        ]
      }
    })
  );
  const res = turnOff({ cwd: tmp, settingsPath: settings });
  assert.equal(res.status, 'off');
  const parsed = JSON.parse(fs.readFileSync(settings, 'utf8'));
  assert.equal(parsed.hooks, undefined);
});
