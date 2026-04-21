import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { NoopReviewer, redactSecrets, toEngineDecision, summarizePolicy } from '../src/ai/reviewer';
import { DEFAULT_POLICY } from '../src/policy/loader';

test('noop reviewer always escalates to manual', async () => {
  const r = new NoopReviewer();
  const out = await r.review({
    prompt: { kind: 'question', raw: 'what?', question: 'what?', provider: 'claude' },
    ctx: { cwd: '/tmp', provider: 'claude', mode: 'hybrid' },
    tail: '',
    policySummary: 'n/a'
  });
  assert.equal(out.decision, 'manual');
});

test('toEngineDecision maps reply to approve with ai source', () => {
  const d = toEngineDecision({ decision: 'reply', reply: 'hi', reason: 'ok' });
  assert.equal(d.type, 'approve');
  assert.equal(d.source, 'ai');
});

test('toEngineDecision maps deny and manual faithfully', () => {
  assert.equal(toEngineDecision({ decision: 'deny', reason: 'no' }).type, 'deny');
  assert.equal(toEngineDecision({ decision: 'manual', reason: 'idk' }).type, 'manual');
});

test('summarizePolicy prints rule counts', () => {
  const s = summarizePolicy(DEFAULT_POLICY);
  assert.match(s, /allow\.commands:\s+\d+\s+rules/);
  assert.match(s, /deny\.commands:\s+\d+\s+rules/);
});

test('redactSecrets masks common secret formats', () => {
  const input = 'API_KEY=sk-ABCDEFGHIJKLMNOPQRST\ntoken: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ1234\nnormal text';
  const out = redactSecrets(input);
  assert.ok(!out.includes('sk-ABCDEFGHIJKLMNOPQRST'));
  assert.ok(!out.includes('ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ1234'));
  assert.match(out, /\[REDACTED\]/);
});

test('redactSecrets leaves plain text untouched', () => {
  assert.equal(redactSecrets('hello world'), 'hello world');
  assert.equal(redactSecrets(''), '');
});
