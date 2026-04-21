import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { PolicyEngine } from '../src/policy/engine';
import { DEFAULT_POLICY } from '../src/policy/loader';
import type { DetectedPrompt, Policy } from '../src/types';

function promptCmd(command: string): DetectedPrompt {
  return { kind: 'command', raw: command, command, provider: 'claude' };
}

function policy(overrides: Partial<Policy> = {}): Policy {
  return {
    ...DEFAULT_POLICY,
    ...overrides,
    allow: { ...DEFAULT_POLICY.allow, ...(overrides.allow ?? {}) },
    deny: { ...DEFAULT_POLICY.deny, ...(overrides.deny ?? {}) },
    requireManual: { ...DEFAULT_POLICY.requireManual, ...(overrides.requireManual ?? {}) },
    aiReply: { ...DEFAULT_POLICY.aiReply, ...(overrides.aiReply ?? {}) }
  };
}

test('deny wins over allow', () => {
  const pol = policy({
    allow: { commands: ['git push *'], read: [], write: [] },
    deny: { commands: ['git push --force *'] }
  });
  const engine = new PolicyEngine(pol);
  const decision = engine.evaluate(promptCmd('git push --force origin main'), {
    cwd: '/tmp',
    provider: 'claude',
    mode: 'hybrid'
  });
  assert.equal(decision.type, 'deny');
});

test('require_manual wins over allow for matching rule', () => {
  const pol = policy({
    allow: { commands: ['npm install'], read: [], write: [] },
    requireManual: { commands: ['npm install'] }
  });
  const decision = new PolicyEngine(pol).evaluate(promptCmd('npm install'), {
    cwd: '/tmp',
    provider: 'claude',
    mode: 'hybrid'
  });
  assert.equal(decision.type, 'manual');
});

test('destructive heuristic escalates unlisted shell metachars', () => {
  const pol = policy({ allow: { commands: ['git diff *'], read: [], write: [] } });
  const decision = new PolicyEngine(pol).evaluate(promptCmd('git diff || rm -rf .'), {
    cwd: '/tmp',
    provider: 'claude',
    mode: 'hybrid'
  });
  assert.equal(decision.type, 'manual');
});

test('approve path returns rule name', () => {
  const decision = new PolicyEngine(DEFAULT_POLICY).evaluate(promptCmd('npm test'), {
    cwd: '/tmp',
    provider: 'claude',
    mode: 'hybrid'
  });
  assert.equal(decision.type, 'approve');
  assert.equal(decision.rule, 'npm test');
});

test('unknown command in quick mode becomes manual', () => {
  const pol = policy({ mode: 'quick', aiReply: { ...DEFAULT_POLICY.aiReply, enabled: false } });
  const decision = new PolicyEngine(pol).evaluate(promptCmd('some-unknown-tool'), {
    cwd: '/tmp',
    provider: 'claude',
    mode: 'quick'
  });
  assert.equal(decision.type, 'manual');
});

test('unknown command in hybrid mode delegates to AI reviewer', () => {
  const decision = new PolicyEngine(DEFAULT_POLICY).evaluate(promptCmd('random-tool --flag'), {
    cwd: '/tmp',
    provider: 'claude',
    mode: 'hybrid'
  });
  assert.equal(decision.type, 'ask_ai');
});

test('empty command falls back to manual', () => {
  const decision = new PolicyEngine(DEFAULT_POLICY).evaluate(promptCmd(''), {
    cwd: '/tmp',
    provider: 'claude',
    mode: 'hybrid'
  });
  assert.equal(decision.type, 'manual');
});

test('file write to allow.write is approved', () => {
  const decision = new PolicyEngine(DEFAULT_POLICY).evaluate(
    { kind: 'file_write', raw: 'write src/index.ts', target: 'src/index.ts', provider: 'claude' },
    { cwd: '/tmp', provider: 'claude', mode: 'hybrid' }
  );
  assert.equal(decision.type, 'approve');
});

test('file write to outside allow.write is escalated', () => {
  const decision = new PolicyEngine(DEFAULT_POLICY).evaluate(
    { kind: 'file_write', raw: 'write /etc/passwd', target: '/etc/passwd', provider: 'claude' },
    { cwd: '/tmp', provider: 'claude', mode: 'hybrid' }
  );
  assert.notEqual(decision.type, 'approve');
});
