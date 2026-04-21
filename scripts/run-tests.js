#!/usr/bin/env node
// Cross-version test runner.
//
// Node 22 accepts glob patterns directly via `node --test "dist/test/**/*.test.js"`.
// Node 18 and 20 do NOT — they either take an explicit list of files or a
// single directory. To stay portable we enumerate the files ourselves and
// pass them to the runner as positional arguments.
'use strict';

const { readdirSync, statSync } = require('fs');
const { spawnSync } = require('child_process');
const { join } = require('path');

function collect(dir) {
  let out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch (err) {
    if (err && err.code === 'ENOENT') return out;
    throw err;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out = out.concat(collect(full));
    } else if (st.isFile() && /\.test\.js$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const testDir = 'dist/test';
const files = collect(testDir);

if (files.length === 0) {
  console.error(`No compiled test files found under ${testDir}. Did you run \`npm run build\`?`);
  process.exit(2);
}

// `spec` reporter was added in Node 19.9. On older 18.x lines fall back to
// the default tap reporter so the run is still green.
const major = Number(process.versions.node.split('.')[0]);
const minor = Number(process.versions.node.split('.')[1]);
const specSupported = major > 19 || (major === 19 && minor >= 9);
const reporter = specSupported ? 'spec' : 'tap';

const args = ['--test', `--test-reporter=${reporter}`, ...files];
const result = spawnSync(process.execPath, args, { stdio: 'inherit' });
process.exit(result.status == null ? 1 : result.status);
