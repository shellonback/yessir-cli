import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ClaudeCliReviewer, buildPrompt, parseResponse } from '../src/ai/reviewers/claude-cli';

function fakeClaudeScript(body: string): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'yr-claude-'));
  const script = path.join(tmp, 'claude');
  fs.writeFileSync(script, `#!/bin/sh\n${body}\n`);
  fs.chmodSync(script, 0o755);
  return script;
}

test('buildPrompt includes every salient field', () => {
  const s = buildPrompt({
    prompt: {
      kind: 'command',
      raw: 'npm test',
      command: 'npm test',
      provider: 'claude'
    },
    ctx: { cwd: '/project', provider: 'claude', mode: 'ai' },
    tail: 'hello world',
    policySummary: 'mode: ai\nallow.commands: 0 rules'
  });
  assert.match(s, /Action kind: command/);
  assert.match(s, /npm test/);
  assert.match(s, /Provider: claude/);
  assert.match(s, /Working directory: \/project/);
  assert.match(s, /Policy mode: ai/);
  assert.match(s, /hello world/);
  assert.match(s, /"decision":"approve"\|"deny"\|"manual"\|"reply"/);
});

test('parseResponse extracts JSON from `result` field', () => {
  const raw = JSON.stringify({
    result: 'Sure. {"decision":"approve","reason":"safe read"}',
    is_error: false
  });
  const out = parseResponse(raw);
  assert.equal(out.decision, 'approve');
  assert.equal(out.reason, 'safe read');
});

test('parseResponse falls back to manual on missing JSON', () => {
  const raw = JSON.stringify({ result: 'I cannot answer right now.' });
  const out = parseResponse(raw);
  assert.equal(out.decision, 'manual');
  assert.match(String(out.reason), /did not emit a JSON decision/);
});

test('parseResponse handles raw JSON (no wrapper)', () => {
  const raw = '{"decision":"deny","reason":"will overwrite .env"}';
  const out = parseResponse(raw);
  assert.equal(out.decision, 'deny');
  assert.match(String(out.reason), /\.env/);
});

test('parseResponse normalizes alternative decision words', () => {
  const raw = JSON.stringify({ result: '{"decision":"allow","reason":"ok"}' });
  const out = parseResponse(raw);
  assert.equal(out.decision, 'approve');
});

test('parseResponse surfaces reply decisions with text', () => {
  const raw = JSON.stringify({
    result: '{"decision":"reply","reply":"Yes, run only the failing tests.","reason":"answering a workflow question"}'
  });
  const out = parseResponse(raw);
  assert.equal(out.decision, 'reply');
  assert.equal(out.reply, 'Yes, run only the failing tests.');
});

test('ClaudeCliReviewer spawns the fake claude and parses its output', async () => {
  const script = fakeClaudeScript(
    `printf '%s' '{"result":"{\\"decision\\":\\"approve\\",\\"reason\\":\\"all green\\"}"}'`
  );
  const reviewer = new ClaudeCliReviewer({ binary: script, timeoutMs: 5000 });
  const out = await reviewer.review({
    prompt: { kind: 'command', raw: 'npm test', command: 'npm test', provider: 'claude' },
    ctx: { cwd: '/tmp', provider: 'claude', mode: 'ai' },
    tail: '',
    policySummary: ''
  });
  assert.equal(out.decision, 'approve');
  assert.equal(out.reason, 'all green');
});

test('ClaudeCliReviewer returns manual when the subprocess errors out', async () => {
  const script = fakeClaudeScript(`echo "boom" >&2\nexit 1`);
  const reviewer = new ClaudeCliReviewer({ binary: script, timeoutMs: 5000 });
  const out = await reviewer.review({
    prompt: { kind: 'command', raw: 'x', command: 'x', provider: 'claude' },
    ctx: { cwd: '/tmp', provider: 'claude', mode: 'ai' },
    tail: '',
    policySummary: ''
  });
  assert.equal(out.decision, 'manual');
  assert.match(String(out.reason), /claude reviewer failed/);
});

test('ClaudeCliReviewer returns manual on timeout', async () => {
  const script = fakeClaudeScript(`sleep 5`);
  const reviewer = new ClaudeCliReviewer({ binary: script, timeoutMs: 200 });
  const out = await reviewer.review({
    prompt: { kind: 'command', raw: 'x', command: 'x', provider: 'claude' },
    ctx: { cwd: '/tmp', provider: 'claude', mode: 'ai' },
    tail: '',
    policySummary: ''
  });
  assert.equal(out.decision, 'manual');
  assert.match(String(out.reason), /timeout/);
});
