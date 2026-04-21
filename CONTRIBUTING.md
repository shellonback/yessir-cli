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

## What we will likely decline

- Features that require a hosted service.
- Default-on allow rules that trust unknown commands.
- Adapters that bypass the policy engine.
- Changes that add runtime dependencies (the whole point is a tiny, auditable footprint).
