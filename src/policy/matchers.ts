// Command and path matching primitives.
//
// Commands use a wildcard glob restricted to `*` (any run of non-newline
// characters except dangerous shell metachars when those are not in the
// pattern itself). "Dangerous" here means tokens that can compose new
// commands: chaining (`;`, `&&`, `||`), backgrounding (`&`), command
// substitution (backtick, `$(...)`).
//
// Redirects (`>`, `<`, `>>`, `2>`, `&>`) and the humble pipe (`|`) are
// explicitly NOT considered dangerous by themselves: they are ubiquitous in
// everyday commands (`ls 2>/dev/null`, `cat foo | wc -l`). The genuinely
// dangerous pipe-to-shell pattern (`curl … | bash`) is caught separately by
// the destructive-heuristic regex in the policy engine.

const COMMAND_DANGEROUS_METACHARS = /[&;`]|\$\(|<\(|>\(|\|\|/;

export function normalizeCommand(input: string): string {
  return String(input).replace(/\s+/g, ' ').trim();
}

export function commandPatternToRegex(pattern: string): RegExp {
  const norm = normalizeCommand(pattern);
  let re = '';
  for (let i = 0; i < norm.length; i++) {
    const ch = norm[i] ?? '';
    if (ch === '*') {
      // `*` matches any run of characters except the ones that can start a
      // brand new command: chaining (`;`, `&`, `||`), backtick substitution,
      // `$(...)` and process substitution. Single pipe and redirects are
      // allowed — they are legitimate parts of everyday invocations. We use
      // a negative lookahead `(?!\|)` so a lone `|` is fine but `||` is not.
      re += '(?:[^&;`$\\n|]|\\|(?!\\|))*';
    } else if ('.+?^=!:${}()[]/\\'.includes(ch)) {
      re += '\\' + ch;
    } else {
      re += ch;
    }
  }
  return new RegExp('^' + re + '$');
}

export interface CommandMatchResult {
  matched: boolean;
  rule?: string;
}

export function matchCommand(command: string, patterns: readonly string[]): CommandMatchResult {
  const cmd = normalizeCommand(command);
  if (!cmd) return { matched: false };
  for (const pattern of patterns) {
    if (!pattern) continue;
    if (commandPatternToRegex(pattern).test(cmd)) {
      return { matched: true, rule: pattern };
    }
  }
  return { matched: false };
}

export function containsShellMetacharacters(command: string): boolean {
  return COMMAND_DANGEROUS_METACHARS.test(command);
}

// Minimal glob matcher for path patterns. Supports:
//   * matches any run of non-slash characters
//   ** matches any number of path segments (including zero)
//   ? matches a single non-slash character
export function pathGlobToRegex(pattern: string): RegExp {
  const norm = String(pattern).trim();
  let re = '';
  let i = 0;
  while (i < norm.length) {
    const ch = norm[i] ?? '';
    const next = norm[i + 1];
    if (ch === '*' && next === '*') {
      // `**` optionally followed by `/`
      if (norm[i + 2] === '/') {
        re += '(?:.*/)?';
        i += 3;
        continue;
      }
      re += '.*';
      i += 2;
      continue;
    }
    if (ch === '*') {
      re += '[^/]*';
      i += 1;
      continue;
    }
    if (ch === '?') {
      re += '[^/]';
      i += 1;
      continue;
    }
    if ('.+^=!:${}()[]/\\|'.includes(ch)) {
      re += '\\' + ch;
    } else {
      re += ch;
    }
    i += 1;
  }
  return new RegExp('^' + re + '$');
}

export function matchPath(path: string, patterns: readonly string[]): CommandMatchResult {
  const p = String(path).replace(/^\.\//, '').replace(/\\/g, '/').trim();
  if (!p) return { matched: false };
  for (const pattern of patterns) {
    if (!pattern) continue;
    if (pathGlobToRegex(pattern).test(p)) {
      return { matched: true, rule: pattern };
    }
  }
  return { matched: false };
}
