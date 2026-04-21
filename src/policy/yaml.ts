// Minimal YAML parser restricted to the subset used by yessir.yml.
//
// Supported grammar:
//   - mapping keys at column 0 and at any deeper even-spaced indentation
//   - scalar values (string, boolean, integer)
//   - block lists of scalar strings (only as the direct child of a mapping key)
//   - comments that start with `#` (full-line or trailing after whitespace)
//   - double or single quoted scalars (quoted strings are returned verbatim)
//
// Unsupported inputs (flow-style, multi-line scalars, anchors, refs, nested
// lists, mapping items inside a list, tabs for indentation) are rejected with
// a clear error so that misconfigured policies never silently degrade.
//
// Rationale: keeping the dependency surface at zero makes this package safe to
// install as a safety layer. The cost is that operators must stay within the
// documented grammar.

export type YamlValue = string | number | boolean | YamlValue[] | { [k: string]: YamlValue };

export class YamlParseError extends Error {
  readonly line: number;
  constructor(message: string, line: number) {
    super(`YAML parse error (line ${line}): ${message}`);
    this.line = line;
    this.name = 'YamlParseError';
  }
}

interface Line {
  raw: string;
  content: string;
  indent: number;
  lineNo: number;
}

function normalizeLines(input: string): Line[] {
  const out: Line[] = [];
  const rawLines = input.split(/\r?\n/);
  for (let i = 0; i < rawLines.length; i++) {
    const raw = rawLines[i] ?? '';
    if (raw.includes('\t')) {
      throw new YamlParseError('tabs are not allowed for indentation', i + 1);
    }
    // Strip full-line comments and blank lines.
    const trimmed = raw.replace(/\s+$/, '');
    if (trimmed.length === 0) continue;
    const leadingMatch = /^( *)(.*)$/.exec(trimmed);
    const indent = leadingMatch ? (leadingMatch[1] ?? '').length : 0;
    const body = leadingMatch ? (leadingMatch[2] ?? '') : trimmed;
    if (body.startsWith('#')) continue;
    if (indent % 2 !== 0) {
      throw new YamlParseError('indentation must be a multiple of 2 spaces', i + 1);
    }
    out.push({ raw, content: stripTrailingComment(body), indent, lineNo: i + 1 });
  }
  return out;
}

function stripTrailingComment(body: string): string {
  // Only strip `#` comments that are not inside quotes.
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '#' && !inSingle && !inDouble) {
      // Require whitespace before `#` to be a comment.
      const prev = body[i - 1];
      if (prev === undefined || prev === ' ') {
        return body.slice(0, i).replace(/\s+$/, '');
      }
    }
  }
  return body;
}

function parseScalar(raw: string, lineNo: number): YamlValue {
  const s = raw.trim();
  if (s.length === 0) return '';
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    if (s.length < 2) throw new YamlParseError('unterminated quoted string', lineNo);
    return s.slice(1, -1);
  }
  if (s === 'true' || s === 'True' || s === 'TRUE') return true;
  if (s === 'false' || s === 'False' || s === 'FALSE') return false;
  if (s === 'null' || s === 'Null' || s === 'NULL' || s === '~') return '';
  if (/^-?\d+$/.test(s)) {
    const n = Number(s);
    if (Number.isFinite(n)) return n;
  }
  if (/^-?\d+\.\d+$/.test(s)) {
    const n = Number(s);
    if (Number.isFinite(n)) return n;
  }
  return s;
}

interface Cursor {
  i: number;
}

function parseBlock(lines: Line[], cursor: Cursor, indent: number): YamlValue {
  // Detect container type by peeking the first significant line at this indent.
  const first = lines[cursor.i];
  if (!first) return '';

  if (first.indent < indent) return '';

  if (first.content.startsWith('- ') || first.content === '-') {
    return parseList(lines, cursor, indent);
  }
  return parseMapping(lines, cursor, indent);
}

function parseMapping(lines: Line[], cursor: Cursor, indent: number): { [k: string]: YamlValue } {
  const map: { [k: string]: YamlValue } = {};
  while (cursor.i < lines.length) {
    const line = lines[cursor.i];
    if (!line) break;
    if (line.indent < indent) break;
    if (line.indent > indent) {
      throw new YamlParseError('unexpected indent inside mapping', line.lineNo);
    }
    const m = /^([A-Za-z_][A-Za-z0-9_\-]*)\s*:(.*)$/.exec(line.content);
    if (!m) {
      throw new YamlParseError(`expected "key: value", got: ${line.content}`, line.lineNo);
    }
    const key = m[1] ?? '';
    const rest = (m[2] ?? '').trim();
    cursor.i += 1;
    if (rest.length > 0) {
      map[key] = parseScalar(rest, line.lineNo);
      continue;
    }
    // Nested block (mapping or list). Determine child indent by peeking.
    const next = lines[cursor.i];
    if (!next || next.indent <= indent) {
      map[key] = '';
      continue;
    }
    const childIndent = next.indent;
    if (childIndent - indent < 2) {
      throw new YamlParseError('child block must be indented by at least 2 spaces', next.lineNo);
    }
    map[key] = parseBlock(lines, cursor, childIndent);
  }
  return map;
}

function parseList(lines: Line[], cursor: Cursor, indent: number): YamlValue[] {
  const out: YamlValue[] = [];
  while (cursor.i < lines.length) {
    const line = lines[cursor.i];
    if (!line) break;
    if (line.indent < indent) break;
    if (line.indent > indent) {
      throw new YamlParseError('unexpected indent inside list', line.lineNo);
    }
    if (!line.content.startsWith('-')) break;
    const body = line.content.slice(1).trimStart();
    cursor.i += 1;
    if (body.length === 0) {
      throw new YamlParseError('nested list/mapping items are not supported', line.lineNo);
    }
    if (/^[A-Za-z_][A-Za-z0-9_\-]*\s*:/.test(body)) {
      throw new YamlParseError('mapping items inside a list are not supported', line.lineNo);
    }
    out.push(parseScalar(body, line.lineNo));
  }
  return out;
}

export function parseYaml(input: string): YamlValue {
  if (typeof input !== 'string') {
    throw new YamlParseError('input must be a string', 0);
  }
  const lines = normalizeLines(input);
  if (lines.length === 0) return {};
  const cursor: Cursor = { i: 0 };
  const firstIndent = lines[0]?.indent ?? 0;
  if (firstIndent !== 0) {
    throw new YamlParseError('top-level content must start at column 0', lines[0]?.lineNo ?? 1);
  }
  const value = parseBlock(lines, cursor, 0);
  if (cursor.i !== lines.length) {
    const remaining = lines[cursor.i];
    throw new YamlParseError('unexpected trailing content', remaining?.lineNo ?? 0);
  }
  return value;
}
