import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Writable } from 'node:stream';
import { runTail, prettyLine, findLogFile } from '../src/commands/tail';

function collector(): { stream: Writable; text: () => string } {
  const chunks: Buffer[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      cb();
    }
  });
  return { stream, text: () => Buffer.concat(chunks).toString('utf8') };
}

function seed(cwd: string, lines: string[]): string {
  const dir = path.join(cwd, '.yessir');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'yessir.log');
  fs.writeFileSync(file, lines.map((l) => l + '\n').join(''));
  return file;
}

test('findLogFile walks up to find the log', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'yt-'));
  const nested = path.join(tmp, 'a', 'b', 'c');
  fs.mkdirSync(nested, { recursive: true });
  const logPath = seed(tmp, ['{}']);
  assert.equal(findLogFile(nested), logPath);
});

test('findLogFile returns null when missing', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'yt-miss-'));
  assert.equal(findLogFile(tmp), null);
});

test('runTail prints historical lines then exits when follow is off', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'yt-hist-'));
  seed(tmp, [
    JSON.stringify({
      ts: '2026-04-21T10:30:00Z',
      level: 'info',
      event: 'hook.decision',
      tool: 'Bash',
      decision: 'approve',
      reason: 'matched allow rule "npm test"'
    }),
    JSON.stringify({
      ts: '2026-04-21T10:30:05Z',
      level: 'info',
      event: 'hook.decision',
      tool: 'Bash',
      decision: 'block',
      reason: 'matched deny rule "rm -rf *"'
    })
  ]);
  const { stream, text } = collector();
  const res = await runTail({
    cwd: tmp,
    follow: false,
    color: false,
    stdout: stream
  });
  assert.equal(res.stopped, 'no-follow');
  const out = text();
  assert.match(out, /10:30:00 .*Bash.*APPROVE.*npm test/);
  assert.match(out, /10:30:05 .*Bash.*BLOCK.*rm -rf/);
});

test('runTail honors --lines bound', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'yt-lines-'));
  const entries: string[] = [];
  for (let i = 0; i < 10; i++) {
    entries.push(
      JSON.stringify({
        ts: `2026-04-21T10:30:${String(i).padStart(2, '0')}Z`,
        level: 'info',
        event: 'hook.decision',
        tool: 'Bash',
        decision: 'approve',
        reason: `rule ${i}`
      })
    );
  }
  seed(tmp, entries);
  const { stream, text } = collector();
  await runTail({ cwd: tmp, follow: false, color: false, lines: 3, stdout: stream });
  const lines = text().trim().split('\n');
  assert.equal(lines.length, 3);
  assert.match(lines[lines.length - 1] ?? '', /rule 9/);
});

test('runTail with --raw prints lines verbatim', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'yt-raw-'));
  const json = JSON.stringify({
    ts: 't',
    event: 'hook.decision',
    decision: 'approve',
    reason: 'x'
  });
  seed(tmp, [json]);
  const { stream, text } = collector();
  await runTail({
    cwd: tmp,
    follow: false,
    raw: true,
    color: false,
    stdout: stream
  });
  assert.equal(text().trim(), json);
});

test('runTail follows new writes and stops on abort', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'yt-follow-'));
  const file = seed(tmp, []);
  const controller = new AbortController();
  const { stream, text } = collector();
  const done = runTail({
    cwd: tmp,
    follow: true,
    color: false,
    stdout: stream,
    signal: controller.signal
  });

  // Wait a bit for the poller to start, then append a line.
  await new Promise((r) => setTimeout(r, 250));
  fs.appendFileSync(
    file,
    JSON.stringify({
      ts: '2026-04-21T10:30:00Z',
      level: 'info',
      event: 'hook.decision',
      tool: 'Bash',
      decision: 'approve',
      reason: 'live append'
    }) + '\n'
  );
  await new Promise((r) => setTimeout(r, 800));
  controller.abort();
  const res = await done;
  assert.equal(res.stopped, 'signal');
  assert.match(text(), /live append/);
});

test('prettyLine formats hook.decision approve', () => {
  const line = JSON.stringify({
    ts: '2026-04-21T09:10:11Z',
    level: 'info',
    event: 'hook.decision',
    tool: 'Bash',
    decision: 'approve',
    reason: 'rule ok'
  });
  const out = prettyLine(line, false);
  assert.match(out, /09:10:11/);
  assert.match(out, /APPROVE/);
  assert.match(out, /rule ok/);
});

test('prettyLine handles malformed JSON gracefully', () => {
  const out = prettyLine('{not json', false);
  assert.match(out, /not json/);
});

test('prettyLine handles legacy plain-text lines', () => {
  const out = prettyLine('2026-04-21T10:30:00Z Bash -> approve (ok)', false);
  assert.match(out, /Bash/);
});

test('runTail reports clear error when explicit log path is missing', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'yt-miss2-'));
  const fakeLog = path.join(tmp, 'definitely-not-here.log');
  const { stream, text } = collector();
  const res = await runTail({
    cwd: tmp,
    follow: false,
    color: false,
    logPath: fakeLog,
    stdout: stream
  });
  assert.equal(res.stopped, 'error');
  assert.match(text(), /no log found/);
});
