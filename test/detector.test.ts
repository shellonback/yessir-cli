import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { getAdapter } from '../src/detector';

test('claude adapter detects "Run `cmd`?"', () => {
  const a = getAdapter('claude');
  const p = a.detect('Claude will now perform an action.\nRun `npm test`?');
  assert.ok(p);
  assert.equal(p!.kind, 'command');
  assert.equal(p!.command, 'npm test');
});

test('claude adapter detects Edit file prompt', () => {
  const a = getAdapter('claude');
  const p = a.detect('Edit file "src/app.ts"?');
  assert.ok(p);
  assert.equal(p!.kind, 'file_edit');
  assert.equal(p!.target, 'src/app.ts');
});

test('claude adapter detects (Y/n)', () => {
  const a = getAdapter('claude');
  const p = a.detect('Continue? (Y/n) ');
  assert.ok(p);
  assert.equal(p!.kind, 'yes_no');
});

test('claude adapter detects numbered menu', () => {
  const a = getAdapter('claude');
  const p = a.detect('1. Yes\n2. Yes, and do not ask again\n3. No');
  assert.ok(p);
  assert.equal(p!.kind, 'yes_no');
});

test('generic adapter detects last-line question', () => {
  const a = getAdapter('generic');
  const p = a.detect('Some output\nWhich option do you want?');
  assert.ok(p);
  assert.equal(p!.kind, 'question');
});

test('returns null when no prompt', () => {
  const a = getAdapter('claude');
  assert.equal(a.detect(''), null);
  assert.equal(a.detect('nothing to see here\n'), null);
});

test('approve/deny bytes are correct per provider', () => {
  const claude = getAdapter('claude');
  const codex = getAdapter('codex');
  const generic = getAdapter('generic');
  const prompt = { kind: 'yes_no' as const, raw: '(Y/n)', provider: 'claude' as const };
  assert.equal(claude.approveBytes(prompt), '\r');
  assert.equal(codex.approveBytes(prompt as never), 'y\r');
  assert.equal(generic.denyBytes(prompt as never), 'n\r');
});

test('claude approve writes "1\\r" on numbered menus', () => {
  const claude = getAdapter('claude');
  const bytes = claude.approveBytes({
    kind: 'yes_no' as const,
    raw: '1. Yes   2. No',
    provider: 'claude' as const
  });
  assert.equal(bytes, '1\r');
});

test('claude deny picks the right numbered option for 2-opt and 3-opt menus', () => {
  const claude = getAdapter('claude');
  const twoOpt = claude.denyBytes({
    kind: 'yes_no' as const,
    raw: '1. Yes   2. No',
    provider: 'claude' as const
  });
  assert.equal(twoOpt, '2\r');

  const threeOpt = claude.denyBytes({
    kind: 'yes_no' as const,
    raw: '1. Yes   2. Yes, allow all edits during this session   3. No',
    provider: 'claude' as const
  });
  assert.equal(threeOpt, '3\r');
});

test('claude deny falls back to n\\r on classic (y/N) confirmations', () => {
  const claude = getAdapter('claude');
  assert.equal(
    claude.denyBytes({
      kind: 'yes_no' as const,
      raw: 'Continue? (y/N)',
      provider: 'claude' as const
    }),
    'n\r'
  );
});
