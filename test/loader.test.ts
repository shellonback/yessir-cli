import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { parsePolicy, loadPolicy, findPolicyFile, PolicyLoadError } from '../src/policy/loader';

const SAMPLE = `mode: hybrid

allow:
  commands:
    - git status
    - git diff *
  read:
    - "**/*"
  write:
    - src/**

deny:
  commands:
    - rm -rf *

require_manual:
  commands:
    - git push

ai_reply:
  enabled: true
  model: auto
  max_tail_lines: 100
  require_manual_on:
    - secrets
`;

test('parses a well-formed policy', () => {
  const p = parsePolicy(SAMPLE);
  assert.equal(p.mode, 'hybrid');
  assert.deepEqual(p.allow.commands, ['git status', 'git diff *']);
  assert.deepEqual(p.allow.read, ['**/*']);
  assert.deepEqual(p.allow.write, ['src/**']);
  assert.deepEqual(p.deny.commands, ['rm -rf *']);
  assert.deepEqual(p.requireManual.commands, ['git push']);
  assert.equal(p.aiReply.enabled, true);
  assert.equal(p.aiReply.maxTailLines, 100);
  assert.deepEqual(p.aiReply.requireManualOn, ['secrets']);
});

test('rejects invalid mode', () => {
  assert.throws(() => parsePolicy('mode: turbo\n'), PolicyLoadError);
});

test('rejects non-numeric max_tail_lines', () => {
  assert.throws(() => parsePolicy('ai_reply:\n  max_tail_lines: many\n'), PolicyLoadError);
});

test('accepts empty file and falls back to defaults', () => {
  const p = parsePolicy('');
  assert.equal(p.mode, 'hybrid');
  assert.deepEqual(p.allow.commands, []);
});

test('findPolicyFile walks up directories', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'paa-find-'));
  const nested = path.join(tmp, 'a', 'b', 'c');
  fs.mkdirSync(nested, { recursive: true });
  const policyPath = path.join(tmp, '.yessir', 'yessir.yml');
  fs.mkdirSync(path.dirname(policyPath), { recursive: true });
  fs.writeFileSync(policyPath, 'mode: quick\n');
  const found = findPolicyFile(nested);
  assert.equal(found, policyPath);
  assert.equal(loadPolicy(found!).mode, 'quick');
});

test('findPolicyFile returns null when missing', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'paa-find-miss-'));
  assert.equal(findPolicyFile(tmp), null);
});
