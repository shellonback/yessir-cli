import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { hookInputToPrompt, processHookInput } from '../src/hook/pretooluse';
import { runHookOnce } from '../src/commands/hook';
import { DEFAULT_POLICY } from '../src/policy/loader';

// In tests we always want to exercise the decision path, so we opt into the
// "all" scope. Session scoping is verified in its own test below.
const ALL: { cwd: string; policy: typeof DEFAULT_POLICY; scope: 'all' } = {
  cwd: '/tmp',
  policy: DEFAULT_POLICY,
  scope: 'all'
};

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

test('processHookInput approves safe command under allow=*', async () => {
  const out = await processHookInput(
    { tool_name: 'Bash', tool_input: { command: 'npm test' } },
    ALL
  );
  assert.equal(out.decision, 'approve');
  const hookOut = (out.hookSpecificOutput ?? {}) as Record<string, unknown>;
  assert.equal(hookOut.permissionDecision, 'allow');
});

test('processHookInput blocks denylisted command', async () => {
  const out = await processHookInput(
    { tool_name: 'Bash', tool_input: { command: 'rm -rf /' } },
    ALL
  );
  assert.equal(out.decision, 'block');
  const hookOut = (out.hookSpecificOutput ?? {}) as Record<string, unknown>;
  assert.equal(hookOut.permissionDecision, 'deny');
});

test('processHookInput passes unknown through when allow list is empty + noAi', async () => {
  const strictPolicy = {
    ...DEFAULT_POLICY,
    mode: 'quick' as const,
    allow: { commands: [], read: [], write: [] },
    aiReply: { ...DEFAULT_POLICY.aiReply, enabled: false }
  };
  const out = await processHookInput(
    { tool_name: 'Bash', tool_input: { command: 'some-rare-tool --flag' } },
    { cwd: '/tmp', policy: strictPolicy, scope: 'all' }
  );
  assert.equal(out.continue, true);
  assert.notEqual(out.decision, 'approve');
});

test('processHookInput handles missing tool_name', async () => {
  const out = await processHookInput({} as never, ALL);
  assert.equal(out.continue, true);
  assert.notEqual(out.decision, 'approve');
});

test('processHookInput session scope: passthrough when YESSIR_ACTIVE not set', async () => {
  const prev = process.env.YESSIR_ACTIVE;
  delete process.env.YESSIR_ACTIVE;
  try {
    const out = await processHookInput(
      { tool_name: 'Bash', tool_input: { command: 'rm -rf /' } },
      { cwd: '/tmp', policy: DEFAULT_POLICY, scope: 'session' }
    );
    // Even a deny-listed command does NOT block when the session was not
    // launched under yessir. This is the whole point of session scoping.
    assert.equal(out.continue, true);
    assert.notEqual(out.decision, 'block');
    assert.match(String(out.reason), /passthrough/);
  } finally {
    if (prev !== undefined) process.env.YESSIR_ACTIVE = prev;
  }
});

test('processHookInput session scope: decides when YESSIR_ACTIVE=1', async () => {
  const prev = process.env.YESSIR_ACTIVE;
  process.env.YESSIR_ACTIVE = '1';
  try {
    const out = await processHookInput(
      { tool_name: 'Bash', tool_input: { command: 'rm -rf /' } },
      { cwd: '/tmp', policy: DEFAULT_POLICY, scope: 'session' }
    );
    assert.equal(out.decision, 'block');
  } finally {
    if (prev === undefined) delete process.env.YESSIR_ACTIVE;
    else process.env.YESSIR_ACTIVE = prev;
  }
});

test('processHookInput YESSIR_SCOPE=all env override makes decisions without YESSIR_ACTIVE', async () => {
  const prevScope = process.env.YESSIR_SCOPE;
  const prevActive = process.env.YESSIR_ACTIVE;
  process.env.YESSIR_SCOPE = 'all';
  delete process.env.YESSIR_ACTIVE;
  try {
    const out = await processHookInput(
      { tool_name: 'Bash', tool_input: { command: 'rm -rf /' } },
      { cwd: '/tmp', policy: DEFAULT_POLICY }
    );
    assert.equal(out.decision, 'block');
  } finally {
    if (prevScope === undefined) delete process.env.YESSIR_SCOPE;
    else process.env.YESSIR_SCOPE = prevScope;
    if (prevActive !== undefined) process.env.YESSIR_ACTIVE = prevActive;
  }
});

test('processHookInput honors YESSIR_BYPASS (anti-recursion)', async () => {
  const prev = process.env.YESSIR_BYPASS;
  process.env.YESSIR_BYPASS = '1';
  try {
    const out = await processHookInput(
      { tool_name: 'Bash', tool_input: { command: 'rm -rf /' } },
      ALL
    );
    assert.equal(out.continue, true);
    assert.match(String(out.reason), /YESSIR_BYPASS/);
  } finally {
    if (prev === undefined) delete process.env.YESSIR_BYPASS;
    else process.env.YESSIR_BYPASS = prev;
  }
});

test('processHookInput in mode:ai routes approve decisions through the reviewer', async () => {
  // With allow=* the deterministic path is approve; in mode:ai we still want
  // the AI to have final say (the whole reason to turn mode:ai on).
  const aiPolicy = { ...DEFAULT_POLICY, mode: 'ai' as const };
  let called = false;
  const stubReviewer = {
    name: 'stub',
    async review() {
      called = true;
      return { decision: 'deny' as const, reason: 'model said no', model: 'stub' };
    }
  };
  const out = await processHookInput(
    { tool_name: 'Bash', tool_input: { command: 'echo hello' } },
    { cwd: '/tmp', policy: aiPolicy, reviewer: stubReviewer, scope: 'all' }
  );
  assert.equal(called, true, 'reviewer must be invoked');
  // Reviewer's "deny" maps to block on the output (still within guardrails).
  assert.equal(out.decision, 'block');
});

test('processHookInput in mode:ai preserves hard deny without asking the AI', async () => {
  const aiPolicy = { ...DEFAULT_POLICY, mode: 'ai' as const };
  let called = false;
  const stubReviewer = {
    name: 'stub',
    async review() {
      called = true;
      return { decision: 'approve' as const, reason: 'override', model: 'stub' };
    }
  };
  const out = await processHookInput(
    { tool_name: 'Bash', tool_input: { command: 'rm -rf /' } },
    { cwd: '/tmp', policy: aiPolicy, reviewer: stubReviewer, scope: 'all' }
  );
  // Even though the reviewer would have approved, deny is absolute.
  assert.equal(called, false, 'reviewer must NOT be called on hard deny');
  assert.equal(out.decision, 'block');
});

test('processHookInput in mode:hybrid only invokes reviewer on ask_ai', async () => {
  let called = 0;
  const stubReviewer = {
    name: 'stub',
    async review() {
      called += 1;
      return { decision: 'approve' as const, reason: 'ok', model: 'stub' };
    }
  };
  const hybrid = { ...DEFAULT_POLICY, mode: 'hybrid' as const };
  // `echo` matches allow=*, deterministic approve, reviewer NOT called.
  await processHookInput(
    { tool_name: 'Bash', tool_input: { command: 'echo hi' } },
    { cwd: '/tmp', policy: hybrid, reviewer: stubReviewer, scope: 'all' }
  );
  assert.equal(called, 0);
});

test('processHookInput uses the AI reviewer when policy routes to ask_ai', async () => {
  const strictPolicy = {
    ...DEFAULT_POLICY,
    mode: 'ai' as const,
    allow: { commands: [], read: [], write: [] }
  };
  const called: string[] = [];
  const stubReviewer = {
    name: 'stub',
    async review(input: { prompt: { command?: string } }) {
      called.push(input.prompt.command ?? '');
      return {
        decision: 'approve' as const,
        reason: 'stub said ok',
        model: 'stub'
      };
    }
  };
  const out = await processHookInput(
    { tool_name: 'Bash', tool_input: { command: 'some-weird-tool' } },
    { cwd: '/tmp', policy: strictPolicy, reviewer: stubReviewer, scope: 'all' }
  );
  assert.deepEqual(called, ['some-weird-tool']);
  assert.equal(out.decision, 'approve');
  assert.match(String(out.reason), /AI reviewer \(stub\)/);
});

test('runHookOnce emits JSON on stdout and never throws on bad JSON', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'paa-badjson-'));
  const res = await runHookOnce({ cwd: tmp, input: '{bad json' });
  const parsed = JSON.parse(res.output);
  assert.equal(parsed.continue, true);
  assert.match(parsed.reason, /invalid JSON/);
});

test('runHookOnce loads policy from nearest .yessir folder', async () => {
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
  // Force scope=all via env var so we don't have to tag the test env.
  const prev = process.env.YESSIR_SCOPE;
  process.env.YESSIR_SCOPE = 'all';
  try {
    const res = await runHookOnce({ cwd: tmp, input });
    const parsed = JSON.parse(res.output);
    assert.equal(parsed.decision, 'approve');
  } finally {
    if (prev === undefined) delete process.env.YESSIR_SCOPE;
    else process.env.YESSIR_SCOPE = prev;
  }
});

test('runHookOnce escalates on invalid policy file', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'paa-bad-'));
  fs.mkdirSync(path.join(tmp, '.yessir'), { recursive: true });
  fs.writeFileSync(path.join(tmp, '.yessir', 'yessir.yml'), 'mode: turbo\n');
  const input = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git status' } });
  const res = await runHookOnce({ cwd: tmp, input });
  const parsed = JSON.parse(res.output);
  assert.equal(parsed.continue, true);
  assert.notEqual(parsed.decision, 'approve');
});

test('runHookOnce handles empty stdin', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'paa-empty-'));
  const res = await runHookOnce({ cwd: tmp, input: '' });
  const parsed = JSON.parse(res.output);
  assert.equal(parsed.continue, true);
});
