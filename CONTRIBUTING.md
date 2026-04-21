# Contributing

Thanks for thinking about sending a change. Keep it small and the review is fast.

## Setup

```bash
git clone https://github.com/shellonback/yessir-cli.git
cd yessir-cli
npm install
npm test
```

`npm test` compiles TypeScript and runs the `node --test` suite. All 86
tests should pass.

## Project layout

```
bin/                 CLI entry point (thin launcher)
src/
  cli.ts             argv -> command dispatcher
  commands/          init, hook, run, doctor, explain
  policy/            YAML parser, loader, matchers, engine
  detector/          provider adapters (claude, codex, gemini, generic)
  tailer/            rolling buffer + ANSI strip
  writer/            PTY write with y-streak + cooldown
  hook/              PreToolUse JSON adapter
  ai/                reviewer interface + noop + redaction
  pty/               node-pty wrapper (lazy-loaded)
  util/              logger, etc.
templates/           policy file template shipped with `init`
test/                node --test suites (one per module)
```

## Adding a provider adapter

1. Create `src/detector/adapters/<name>.ts` implementing `ProviderAdapter`.
2. Wire it in `src/detector/index.ts`.
3. Add patterns that match the provider's prompts against ANSI-stripped text.
4. Cover each regex with a test in `test/detector.test.ts`.

## Changing the policy grammar

Update the parser in `src/policy/yaml.ts`, the loader in `src/policy/loader.ts`,
and the template in `templates/yessir.yml`. Bump the default policy in
`src/policy/loader.ts` and add coverage to `test/loader.test.ts`.

## Releasing a new version

Releases are cut via git tag. The workflow at `.github/workflows/publish.yml`
does the rest:

```bash
# 1. make sure you are on main with a clean tree
git checkout main && git pull

# 2. bump the package version (also creates the commit + tag)
npm version patch    # or `minor` / `major` for breaking changes

# 3. push the commit AND the tag
git push --follow-tags
```

The workflow will:

1. install, typecheck, run all 86 tests on Node 22;
2. verify the tag (`v0.2.3`) matches `package.json` (`0.2.3`);
3. run `npm publish --access public --provenance` signed by GitHub OIDC.

The first-time publish requires one manual step: add an **NPM_TOKEN** secret
to the repo. Generate it on npmjs.com under Access Tokens → Granular →
"Publish" scope for the `yessir-cli` package, then add it as a repository
secret at `https://github.com/shellonback/yessir-cli/settings/secrets/actions`.

To dry-run the publish pipeline without pushing to npm, trigger the workflow
manually from the GitHub Actions tab with `dry_run=true`.

## What we will likely decline

- Features that require a hosted service.
- Default-on allow rules that trust unknown commands.
- Adapters that bypass the policy engine.
- Changes that add runtime dependencies (the whole point is a tiny, auditable footprint).
