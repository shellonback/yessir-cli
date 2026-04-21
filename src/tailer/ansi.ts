// Strip ANSI control sequences from a terminal stream.
// Uses explicit ESC/BEL bytes so the source stays pure ASCII.

const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);

const OSC_RE = new RegExp(ESC + '\\][\\s\\S]*?(?:' + BEL + '|' + ESC + '\\\\)', 'g');
const DCS_RE = new RegExp(ESC + '[PX^_][\\s\\S]*?(?:' + ESC + '\\\\|' + BEL + ')', 'g');
const CSI_RE = new RegExp(ESC + '\\[[0-?]*[ -/]*[@-~]', 'g');
const CHARSET_RE = new RegExp(ESC + '[()*+][A-Z0-9]', 'g');
const SIMPLE_ESC_RE = new RegExp(ESC + '[=>78HDEMZc]', 'g');
// Keep TAB (\t), LF (\n), CR (\r); strip other C0 controls and DEL.
const CONTROL_CHAR_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

export function stripAnsi(input: string): string {
  if (!input) return '';
  let s = input;
  s = s.replace(OSC_RE, '');
  s = s.replace(DCS_RE, '');
  s = s.replace(CSI_RE, '');
  s = s.replace(CHARSET_RE, '');
  s = s.replace(SIMPLE_ESC_RE, '');
  s = s.replace(CONTROL_CHAR_RE, '');
  s = s.replace(/\r+/g, '');
  return s;
}
