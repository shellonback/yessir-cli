import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { TerminalTailer } from '../src/tailer/tailer';
import { stripAnsi } from '../src/tailer/ansi';

test('tailer accumulates clean text', () => {
  const t = new TerminalTailer();
  t.push('hello\n');
  t.push('world\n');
  assert.equal(t.snapshot().text, 'hello\nworld\n');
});

test('tailer ignores empty and null chunks', () => {
  const t = new TerminalTailer();
  t.push('');
  t.push('real\n');
  assert.equal(t.snapshot().text, 'real\n');
});

test('tailer drops oldest lines when maxLines exceeded', () => {
  const t = new TerminalTailer({ maxLines: 3, maxChars: 10_000 });
  for (let i = 0; i < 6; i++) t.push(`line ${i}\n`);
  const lines = t.snapshot().text.split('\n').filter((l) => l.length > 0);
  assert.equal(lines.length, 3);
  assert.deepEqual(lines, ['line 3', 'line 4', 'line 5']);
});

test('tailer respects maxChars before maxLines trim', () => {
  const t = new TerminalTailer({ maxLines: 100, maxChars: 10 });
  t.push('abcdefghijklmnop');
  assert.ok(t.snapshot().chars <= 10);
});

test('tailer strips ANSI sequences', () => {
  const t = new TerminalTailer();
  t.push('[31mred[0m\n');
  assert.equal(t.snapshot().text, 'red\n');
});

test('stripAnsi preserves TAB and newline', () => {
  assert.equal(stripAnsi('a\tb\nc'), 'a\tb\nc');
});

test('stripAnsi removes BEL and DEL', () => {
  assert.equal(stripAnsi('keep\x07me\x7Fnow'), 'keepmenow');
});

test('tailer rejects non-finite bounds', () => {
  assert.throws(() => new TerminalTailer({ maxLines: 0 }));
  assert.throws(() => new TerminalTailer({ maxChars: -1 }));
});

test('tailLines returns last N lines', () => {
  const t = new TerminalTailer();
  t.push('a\nb\nc\nd\n');
  assert.deepEqual(t.tailLines(2), ['d', '']);
  assert.deepEqual(t.tailLines(3), ['c', 'd', '']);
});

test('tailLines returns [] for zero/negative N', () => {
  const t = new TerminalTailer();
  t.push('a\nb\n');
  assert.deepEqual(t.tailLines(0), []);
  assert.deepEqual(t.tailLines(-1), []);
});
