# Security policy

## Reporting a vulnerability

Please email security@shellonback.com or open a private security advisory
on GitHub rather than a public issue. We will acknowledge within 3 working
days and coordinate a disclosure timeline.

## Threat model

Yessir is a local policy layer. It assumes:

- the machine running it is trusted;
- the user controls the policy file;
- any AI reviewer is plugged in consciously by the user.

It is **not** a sandbox. A determined agent can still propose a command and
run it if the user (or policy) approves. The project reduces the blast
radius of casual agent misbehavior; it does not replace OS-level sandboxing.

## What we guard against

- Silent approval of destructive commands via glob ambiguity.
- Policy bypass via shell metacharacters smuggled into "safe" prefixes.
- Infinite-confirmation loops (via the writer's y-streak limit).
- Secrets leaking to a remote AI reviewer (via `redactSecrets`).

## Known limitations

- Policy is only as safe as the rules you write. Review the default
  `require_manual` list before running unattended.
- The ANSI stripper is best-effort; the detector therefore also uses
  positional heuristics (last 40 lines).
- Pattern matching is case-sensitive.
