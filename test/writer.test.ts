import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { TerminalWriter } from '../src/writer/writer';

function makeTarget() {
  const buf: string[] = [];
  return {
    target: { write: (d: string) => { buf.push(d); } },
    bytes: () => buf.join('')
  };
}

test('writes bytes and reports ok', async () => {
  const { target, bytes } = makeTarget();
  const w = new TerminalWriter(target, { cooldownMs: 0, chunkDelayMs: 0 });
  const r = await w.writeApproval('y\r');
  assert.equal(r.ok, true);
  assert.equal(bytes(), 'y\r');
});

test('empty payload is rejected', async () => {
  const { target } = makeTarget();
  const w = new TerminalWriter(target, { cooldownMs: 0 });
  const r = await w.writeApproval('');
  assert.equal(r.ok, false);
});

test('cooldown prevents rapid-fire writes', async () => {
  const { target } = makeTarget();
  const w = new TerminalWriter(target, { cooldownMs: 1_000, chunkDelayMs: 0 });
  const a = await w.writeApproval('y\r');
  assert.equal(a.ok, true);
  const b = await w.writeApproval('y\r');
  assert.equal(b.ok, false);
  assert.match(String(b.reason), /cooldown/);
});

test('y-streak limit disables the writer', async () => {
  const { target } = makeTarget();
  const w = new TerminalWriter(target, {
    cooldownMs: 0,
    chunkDelayMs: 0,
    yStreakLimit: 3
  });
  assert.equal((await w.writeApproval('y\r')).ok, true);
  assert.equal((await w.writeApproval('y\r')).ok, true);
  assert.equal((await w.writeApproval('y\r')).ok, true);
  const overflow = await w.writeApproval('y\r');
  assert.equal(overflow.ok, false);
  assert.ok(w.isDisabled());
});

test('notifyRichOutput resets the streak', async () => {
  const { target } = makeTarget();
  const w = new TerminalWriter(target, {
    cooldownMs: 0,
    chunkDelayMs: 0,
    yStreakLimit: 2
  });
  await w.writeApproval('y\r');
  w.notifyRichOutput();
  await w.writeApproval('y\r');
  assert.equal(w.isDisabled(), false);
});

test('reply resets the y-streak', async () => {
  const { target } = makeTarget();
  const w = new TerminalWriter(target, {
    cooldownMs: 0,
    chunkDelayMs: 0,
    yStreakLimit: 2
  });
  await w.writeApproval('y\r');
  const r = await w.writeReply('answer text\r');
  assert.equal(r.ok, true);
  assert.equal(w.isDisabled(), false);
});

test('reset brings writer back to clean state', async () => {
  const { target } = makeTarget();
  const w = new TerminalWriter(target, {
    cooldownMs: 0,
    chunkDelayMs: 0,
    yStreakLimit: 1
  });
  await w.writeApproval('y\r');
  await w.writeApproval('y\r');
  assert.ok(w.isDisabled());
  w.reset();
  assert.equal(w.isDisabled(), false);
});

test('rejects invalid options', () => {
  assert.throws(() => new TerminalWriter({ write: () => {} }, { chunkSize: 0 }));
  assert.throws(() => new TerminalWriter({ write: () => {} }, { yStreakLimit: 0 }));
});
