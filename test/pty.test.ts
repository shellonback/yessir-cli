import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { resolveBinary, ProviderBinaryNotFoundError } from '../src/pty/wrapper';

test('resolveBinary returns absolute path when found in PATH', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'yes-pty-'));
  const binDir = path.join(tmp, 'bin');
  fs.mkdirSync(binDir);
  const bin = path.join(binDir, 'fakeclaude');
  fs.writeFileSync(bin, '#!/bin/sh\necho ok\n');
  fs.chmodSync(bin, 0o755);
  const resolved = resolveBinary('fakeclaude', { PATH: binDir });
  assert.equal(resolved, bin);
});

test('resolveBinary passes through absolute paths verbatim', () => {
  const abs = '/usr/bin/env';
  assert.equal(resolveBinary(abs, { PATH: '/' }), abs);
});

test('resolveBinary throws ProviderBinaryNotFoundError when missing', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'yes-pty2-'));
  assert.throws(
    () => resolveBinary('doesnotexist', { PATH: tmp }),
    (err: unknown) => {
      assert.ok(err instanceof ProviderBinaryNotFoundError);
      assert.equal((err as ProviderBinaryNotFoundError).binary, 'doesnotexist');
      assert.match((err as Error).message, /could not find executable/);
      return true;
    }
  );
});

test('resolveBinary skips non-executable files', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'yes-pty3-'));
  const bin = path.join(tmp, 'noexec');
  fs.writeFileSync(bin, 'x');
  fs.chmodSync(bin, 0o644);
  assert.throws(() => resolveBinary('noexec', { PATH: tmp }), ProviderBinaryNotFoundError);
});

test('resolveBinary skips empty PATH segments', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'yes-pty4-'));
  const bin = path.join(tmp, 'ok');
  fs.writeFileSync(bin, '#!/bin/sh\n');
  fs.chmodSync(bin, 0o755);
  // Leading empty segment should not search CWD.
  const resolved = resolveBinary('ok', { PATH: `:${tmp}:` });
  assert.equal(resolved, bin);
});
