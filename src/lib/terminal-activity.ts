/** Strip ANSI escape sequences for pattern matching. */
export function stripAnsi(str: string): string {
  return str
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')   // CSI sequences (colors, cursor)
    .replace(/\x1b\][^\x07]*\x07/g, '')       // OSC sequences (title, hyperlinks)
    .replace(/\x1b\(B/g, '');                  // Character set designation
}

/** Simple hash for change detection (avoid re-processing identical captures). */
export function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return hash.toString(36);
}

const ACTION_REQUIRED_PATTERNS = [
  /do you want to (?:allow|proceed|continue)/i,
  /\[y\/n\]/i,
  /\(y\/n\)/i,
  /press enter to continue/i,
  /waiting for (?:input|response|approval)/i,
  /do you want to run/i,
  /allow this action/i,
];

/** Detect action-required patterns (permission prompts, Y/n, etc.) in terminal output. */
export function detectActionRequired(text: string): boolean {
  const clean = stripAnsi(text);
  const lines = clean.split('\n').slice(-10).join('\n');
  return ACTION_REQUIRED_PATTERNS.some((p) => p.test(lines));
}
