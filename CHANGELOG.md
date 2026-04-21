# Changelog

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
