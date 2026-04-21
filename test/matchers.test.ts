import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  commandPatternToRegex,
  containsShellMetacharacters,
  matchCommand,
  matchPath,
  pathGlobToRegex,
  normalizeCommand
} from '../src/policy/matchers';

test('exact command patterns match verbatim', () => {
  assert.equal(matchCommand('git status', ['git status']).matched, true);
  assert.equal(matchCommand('git pull', ['git status']).matched, false);
});

test('wildcard commands match common suffixes', () => {
  assert.equal(matchCommand('git diff HEAD', ['git diff *']).matched, true);
  assert.equal(matchCommand('git diff --stat', ['git diff *']).matched, true);
});

test('wildcard allows redirects and single pipe (they are harmless)', () => {
  assert.equal(matchCommand('ls 2>/dev/null', ['ls *']).matched, true);
  assert.equal(matchCommand('cat foo > /tmp/out', ['cat *']).matched, true);
  assert.equal(matchCommand('cat foo | wc -l', ['cat *']).matched, true);
});

test('wildcard still refuses to cross chaining and substitution', () => {
  assert.equal(matchCommand('git diff && rm -rf .', ['git diff *']).matched, false);
  assert.equal(matchCommand('git diff ; rm -rf .', ['git diff *']).matched, false);
  assert.equal(matchCommand('echo $(rm -rf .)', ['echo *']).matched, false);
  assert.equal(matchCommand('echo `rm -rf .`', ['echo *']).matched, false);
});

test('normalizeCommand collapses whitespace', () => {
  assert.equal(normalizeCommand('  git   status  '), 'git status');
});

test('containsShellMetacharacters flags dangerous tokens only', () => {
  assert.equal(containsShellMetacharacters('git status'), false);
  assert.equal(containsShellMetacharacters('git diff && rm'), true);
  assert.equal(containsShellMetacharacters('ls; rm -rf .'), true);
  assert.equal(containsShellMetacharacters('echo `rm -rf /`'), true);
  assert.equal(containsShellMetacharacters('echo $(rm -rf /)'), true);
});

test('containsShellMetacharacters does NOT flag redirects or pipes', () => {
  assert.equal(containsShellMetacharacters('ls 2>/dev/null'), false);
  assert.equal(containsShellMetacharacters('cat foo > /tmp/out'), false);
  assert.equal(containsShellMetacharacters('cat foo | wc -l'), false);
});

test('containsShellMetacharacters flags process substitution', () => {
  assert.equal(containsShellMetacharacters('diff <(a) <(b)'), true);
  assert.equal(containsShellMetacharacters('tee >(logger)'), true);
});

test('empty command never matches', () => {
  assert.equal(matchCommand('', ['*']).matched, false);
  assert.equal(matchCommand('   ', ['*']).matched, false);
});

test('commandPatternToRegex escapes special characters', () => {
  const re = commandPatternToRegex('npm run test:unit');
  assert.equal(re.test('npm run test:unit'), true);
  assert.equal(re.test('npm run test!unit'), false);
});

test('pathGlobToRegex handles globstar', () => {
  const re = pathGlobToRegex('src/**/*.ts');
  assert.equal(re.test('src/app/index.ts'), true);
  assert.equal(re.test('src/deep/nested/file.ts'), true);
  assert.equal(re.test('app/x.ts'), false);
});

test('matchPath allows top-level ** match', () => {
  assert.equal(matchPath('anything/here.txt', ['**/*']).matched, true);
  assert.equal(matchPath('README.md', ['README.md']).matched, true);
});
