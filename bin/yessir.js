#!/usr/bin/env node
// Thin launcher. Real CLI lives in dist/src/cli.js (compiled from TS).
'use strict';
try {
  require('../dist/src/cli.js').main(process.argv.slice(2));
} catch (err) {
  if (err && err.code === 'MODULE_NOT_FOUND' && /dist\/src\/cli/.test(String(err.message))) {
    process.stderr.write(
      'yessir: missing build output. Run "npm run build" before using the CLI from source.\n'
    );
    process.exit(2);
  }
  process.stderr.write('yessir: fatal error: ' + (err && err.stack || err) + '\n');
  process.exit(1);
}
