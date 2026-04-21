import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { parseArgs } from '../src/cli';

test('parses simple command with flag', () => {
  const r = parseArgs(['claude', '--mode', 'ai']);
  assert.equal(r.command, 'claude');
  assert.equal(r.flags['mode'], 'ai');
});

test('treats boolean flags correctly', () => {
  const r = parseArgs(['claude', '--dry-run']);
  assert.equal(r.flags['dry-run'], true);
});

test('supports --key=value form', () => {
  const r = parseArgs(['explain', '--provider=codex', 'git', 'status']);
  assert.equal(r.flags['provider'], 'codex');
  assert.deepEqual(r.positional, ['explain', 'git', 'status']);
});

test('double dash routes remainder to passthrough', () => {
  const r = parseArgs(['--', 'aider', '--foo', 'bar']);
  assert.equal(r.command, null);
  assert.deepEqual(r.passthrough, ['aider', '--foo', 'bar']);
});

test('command + -- passthrough', () => {
  const r = parseArgs(['run', '--', 'bash', '-c', 'echo hi']);
  assert.equal(r.command, 'run');
  assert.deepEqual(r.passthrough, ['bash', '-c', 'echo hi']);
});
