# Changelog

## 0.1.9 — 2026-04-21

**Session-scoped hook + real AI reviewer.**

- **Session scoping (default).** The PreToolUse hook now intercepts calls
  only when the provider session was launched under yessir (env var
  `YESSIR_ACTIVE=1`). Running `claude` (or any other supported CLI)
  directly bypasses yessir entirely — same behavior as if yessir was
  not installed. To opt in for every session set `YESSIR_SCOPE=all`.
  The PTY wrapper (`yessir claude`, `yessir codex`, etc.) sets
  `YESSIR_ACTIVE=1` on the child process automatically, so running via
  `yessir <provider>` still does the right thing.
- **ClaudeCliReviewer.** `--mode=ai` now actually asks an AI. The
  default reviewer spawns `claude -p --output-format=json` as a
  one-shot subprocess, sends it the tool call + policy summary, and
  parses a structured `{decision, reply, reason}` back. No API keys to
  configure: if `claude` is on your PATH, you have a reviewer.
- **Hook calls the reviewer on `ask_ai`.** `processHookInput` is now
  async and, when the engine routes a tool call to `ask_ai` (mode != quick,
  aiReply enabled), it delegates to the configured reviewer instead of
  blindly returning "ask". Reviewer timeout is 30s by default (override
  with env `YESSIR_REVIEWER_TIMEOUT_MS`).
- **Anti-recursion bypass.** The reviewer subprocess inherits
  `YESSIR_BYPASS=1`. If it ever triggers the hook (shouldn't, but
  defensive), the hook returns an immediate passthrough instead of
  calling the reviewer again and spiraling.
- Pluggable: `YESSIR_REVIEWER=noop` falls back to the old behavior,
  `YESSIR_REVIEWER=claude` (default) uses the Claude CLI backend.
  Additional backends can be plugged via the exported `AiReviewer`
  interface.

Tests: 128 total, 14 new across scope/bypass/reviewer stubbing and
`ClaudeCliReviewer` happy/error/timeout paths.

## 0.1.8 — 2026-04-21

New `yessir off` / `yessir on` toggle. Lets the user stop yessir from
intercepting tool calls without having to remember which JSON block to
edit or to uninstall anything.

- `yessir off` — walks `.claude/settings.json`, removes every hook
  whose command is `yessir hook` (or `yessir-cli hook`, or an absolute
  path to the binary). Unrelated handlers and entries are preserved
  verbatim. After the next tool call Claude Code invokes its native
  permission flow again.
- `yessir on` — re-installs the PreToolUse hook (same effect as
  `yessir init --hook`). Existing non-hook settings (permissions,
  env vars, etc.) are merged, not overwritten.
- `--global` flag: operates on `~/.claude/settings.json` instead of
  the project-local file.
- Aliases: `yessir stop` / `yessir start`, `yessir disable` /
  `yessir enable`.
- Both commands are idempotent and safe: malformed settings.json
  triggers a refusal with a clear message, not a silent rewrite.
- 7 new tests covering entry removal, handler preservation, empty-
  entry dropping, idempotence, JSON error refusal, and round-trip
  `off → on` preserving unrelated keys.

## 0.1.7 — 2026-04-21

Deny-first default policy + new `deny.write` / `require_manual.write`.

The old "narrow allowlist + everything else → manual" default made
real Claude Code sessions unusable: every `Edit(package.json)`,
every `Bash(echo foo)`, every unknown little utility popped a
"🙋 ASK" at the user. Switch the default to **deny-first**:

  - `allow.commands: ["*"]`
  - `allow.write: ["**"]`
  - `deny.commands`: rm -rf / sudo / curl|bash / npm publish / chmod
    777 / mkfs / dd / shutdown / fork-bomb
  - `deny.write`: .env / .env.* / *.pem / *.key / id_rsa / id_ed25519 /
    .ssh/** / /etc/** / /usr/** / /System/** / ~/.aws/** / ~/.kube/**
  - `require_manual.commands`: git push / git tag / git reset --hard /
    git rebase / git cherry-pick / docker compose up-down /
    npm|pnpm|yarn install-uninstall-remove / brew install-uninstall /
    apt install-remove
  - `require_manual.write`: lockfiles (package-lock.json, pnpm-lock.yaml,
    yarn.lock) — usually regenerated via install, flagging direct edits

New schema additions:
  - `deny.read`, `deny.write`: glob patterns, highest precedence for
    file operations.
  - `require_manual.write`: globs that get escalated even though
    `allow.write` matches (perfect for lockfiles and generated code
    that the user wants to review).
  - Policy engine now checks `deny.write` → `require_manual.write` →
    `allow.write` in that order.

Breaking change — please note:
  - This only affects **new** installs (`yessir init` is still
    idempotent, it won't overwrite your existing `.yessir/yessir.yml`).
  - If you want the new defaults, run `yessir init --force` after
    backing up your policy.
  - The pre-0.1.7 `deny:` / `require_manual:` sections (only
    `commands` key) continue to load fine — the new keys are optional.

3 new engine tests covering deny.write + require_manual.write + the
deny-first approval path. 107/107 green.

## 0.1.6 — 2026-04-21

Smoother defaults, no more double log lines, no more wrapper-vs-hook
collisions on Claude Code.

- **Log de-duplicated.** Each decision used to produce two lines in
  `.yessir/yessir.log`: one structured JSON and one legacy plain text.
  `yessir tail` showed every decision twice. The legacy appender is
  gone — one JSON line per decision, one pretty row in the tail.
- **Default `allow.write` is less restrictive.** It now covers the
  paths every realistic project edits: top-level config (`package.json`,
  `tsconfig*.json`, `.gitignore`, `.editorconfig`, `*.md`, `*.mdx`,
  `*.txt`, lockfiles, `docker-compose.y*ml`, `Dockerfile*`, `.env.example`),
  and common dirs (`scripts/**`, `bin/**`, `.github/**`, `public/**`,
  `assets/**`, `content/**`, `types/**`, `__tests__/**`). The narrow
  0.1.5 default made Claude Code gasp "ask" on almost every `Edit`.
- **Wrapper vs hook collision detector.** `yessir claude` now reads
  `.claude/settings.json` at startup. If it finds a wired yessir
  PreToolUse hook, the PTY detector+writer loop is disabled (the hook
  already decides every tool call; running both layers is what made
  Claude Code's TUI stutter and bleed `[yessir] manual required`
  messages into the rendered output). Opt back in with `--force-detector`.

## 0.1.5 — 2026-04-21

Fewer false positives on everyday shell idioms.

The previous metachar heuristic flagged `2>/dev/null`, `>file`, `<file`
and `cat foo | wc -l` as "dangerous". These are ubiquitous and harmless,
so `yessir init`'s default `allow: ls *` matched `ls /tmp` but escalated
`ls /tmp 2>/dev/null`, which showed up constantly in Claude Code sessions
(the agent loves suppressing stderr).

- Wildcards (`*`) in command patterns now traverse single pipes and
  redirects. So `ls *` matches `ls 2>/dev/null` and `cat *` matches
  `cat foo | wc -l`.
- Wildcards still refuse to cross chaining (`;`, `&`, `&&`, `||`),
  backtick or `$(...)` / `<(...)` / `>(...)` substitution — i.e. the
  tokens that can actually compose a new command.
- The destructive heuristic follows the same rule: it now fires on
  chaining + substitution + `&` only. Redirects and plain pipes are
  no longer "manual" on their own.
- `curl ... | bash` / `wget ... | sh` remain deny-listed via the
  existing destructive regex — that specific pipe-to-shell pattern is
  caught upstream, before the allow match.
- 3 new tests + updated existing ones to lock the new behavior in
  (104/104 green).

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
