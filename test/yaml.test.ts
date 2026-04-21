import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { parseYaml, YamlParseError } from '../src/policy/yaml';

test('parses simple key-value scalars', () => {
  const out = parseYaml('mode: hybrid\nenabled: true\ncount: 42') as Record<string, unknown>;
  assert.equal(out.mode, 'hybrid');
  assert.equal(out.enabled, true);
  assert.equal(out.count, 42);
});

test('parses nested mapping with list', () => {
  const input = 'allow:\n  commands:\n    - git status\n    - git diff *\n';
  const out = parseYaml(input) as { allow: { commands: string[] } };
  assert.deepEqual(out.allow.commands, ['git status', 'git diff *']);
});

test('handles quoted scalars', () => {
  const input = 'read:\n  - "**/*"\n  - \'docs/*\'\n';
  const out = parseYaml(input) as { read: string[] };
  assert.deepEqual(out.read, ['**/*', 'docs/*']);
});

test('ignores comments and blank lines', () => {
  const input = '# top comment\n\nmode: quick # trailing\n# other\n';
  const out = parseYaml(input) as Record<string, unknown>;
  assert.equal(out.mode, 'quick');
});

test('rejects tabs for indentation', () => {
  assert.throws(() => parseYaml('allow:\n\tcommands:\n\t\t- git'), YamlParseError);
});

test('rejects odd indentation', () => {
  assert.throws(() => parseYaml('allow:\n commands:\n'), YamlParseError);
});

test('returns empty object on empty input', () => {
  assert.deepEqual(parseYaml(''), {});
  assert.deepEqual(parseYaml('\n\n# only comments\n'), {});
});

test('rejects nested mapping inside list', () => {
  assert.throws(() => parseYaml('allow:\n  - commands:\n      - x\n'), YamlParseError);
});
