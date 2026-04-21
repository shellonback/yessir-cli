# Changelog

## 0.1.4 — 2026-04-21

PTY wrapper compatibility on Node 25 + clearer error paths.

- Bump optional dependency `node-pty` from `^1.0.0` (fails on Node 25
  with `posix_spawnp failed.` because the native binding predates the
  new Node ABI) to `^1.2.0-beta.12`. `yessir claude`, `yessir codex`,
  `yessir -- <cmd>` now work on Node 22+25 again.
- Resolve provider binaries to absolute paths before calling
  `pty.spawn`. `node-pty` does not reliably honor `$PATH` lookup the
  way `child_process.spawn` does, so `pty.spawn("claude", ...)` failed
  even when `which claude` found it.
- Introduce `ProviderBinaryNotFoundError`: if the resolver cannot
  locate the binary we surface a clear hint ("install the provider CLI
  and make sure it's reachable — try `which <binary>`") instead of
  bubbling up the opaque `posix_spawnp failed.` message.
- 5 new tests covering the PATH resolver.

## 0.1.3 — 2026-04-21

- 🪵 **New `yessir tail` command** (aliases: `watch`, `logs`). Streams the
  decision log at `.yessir/yessir.log` in real time with a compact,
  emoji + ANSI color format:
  ```
  12:00:00 Bash    ✅ APPROVE  matched allow rule "npm test"
  12:00:02 Bash    ⛔ BLOCK    matched deny rule "rm -rf *"
  12:00:04 Write   ✅ APPROVE  matched allow.write rule "src/**"
  12:00:06 Bash    🙋 ASK      unknown command, deferring to AI reviewer
  ```
  Flags: `-n <N>` / `--lines` (default 50), `--no-follow`, `--raw`,
  `--no-color`, `--log-path <file>` (via the programmatic API).
- Fixed two test-suite tmpdir hygiene issues that let a stray
  `.yessir/` leak into `os.tmpdir()` and contaminated ancestor-based
  log lookups.

## 0.1.2 — 2026-04-21

Patch release.

- `yessir --version` now reads from `package.json` at runtime instead of
  using a hardcoded string. Previous releases always printed `0.1.0` no
  matter which version was installed.

## 0.1.1 — 2026-04-21

Patch release.

- Add `yessir-cli` as an alias bin next to `yessir`, so the README's
  advertised `npx yessir-cli init --hook` actually runs. Previously
  `npx yessir-cli` couldn't resolve a bin with that exact name and
  failed with `sh: yessir: command not found`.

## 0.1.0 — initial release

First public release of Yessir, spun off from the safety layer that ships
inside **[PromptOps](https://promptops.it)** — the full AI-agent
orchestration platform by [ShellOnBack](https://shellonback.com). The
policy engine, the Claude Code `PreToolUse` hook and the PTY writer here
are the same building blocks PromptOps uses internally, extracted under
MIT and trimmed to zero runtime dependencies.

- CLI: `init`, `hook`, `claude`, `codex`, `gemini`, `doctor`, `explain`, generic `--` wrapper.
- Policy engine with `deny` / `require_manual` / destructive-heuristic / `allow` precedence.
- Zero-dependency YAML parser for the documented subset.
- Claude Code `PreToolUse` hook adapter: approve, block, or escalate based on policy.
- PTY wrapper with live tail buffer, provider-specific prompt detectors (Claude, Codex, Gemini, generic).
- Terminal writer with y-streak limit, cooldown, and chunked writes.
- Pluggable `AiReviewer` interface with a safe-by-default `NoopReviewer`.
- Secret redaction for context sent to any reviewer.
- File logger at `.yessir/yessir.log`.
- Test suite (86 tests) covering YAML parsing, policy matching, engine decisions, tailer bounds, detector regex, writer concurrency, hook I/O, init idempotence.
