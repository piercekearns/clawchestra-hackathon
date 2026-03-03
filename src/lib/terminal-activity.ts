/** Strip ANSI escape sequences for pattern matching. */
export function stripAnsi(str: string): string {
  return str
    .replace(/\x1b\[[?!>]?[0-9;]*[a-zA-Z~]/g, '')  // CSI sequences (colors, cursor, DEC private modes)
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')  // OSC sequences (title, hyperlinks)
    .replace(/\x1b[()][A-Z0-9]/g, '')                // Character set designation
    .replace(/\x1bP[^\x1b]*\x1b\\/g, '')             // DCS (Device Control String)
    .replace(/\x1b[=>]/g, '')                         // Keypad mode switches
    .replace(/\r/g, '');                              // Carriage returns
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
  /\(yes\/no\)/i,
  /yes\s*\/\s*no/i,
  /press enter to continue/i,
  /waiting for (?:input|response|approval)/i,
  /do you want to run/i,
  /allow this action/i,
  /would you like to (?:proceed|continue)/i,
];

/** Grace period for newly spawned terminals — protects from liveness poll removal. */
const spawnGrace = new Map<string, number>();
const SPAWN_GRACE_MS = 60_000;

export function addTerminalSpawnGrace(chatId: string): void {
  spawnGrace.set(chatId, Date.now());
}

export function hasTerminalSpawnGrace(chatId: string): boolean {
  const ts = spawnGrace.get(chatId);
  if (!ts) return false;
  if (Date.now() - ts > SPAWN_GRACE_MS) {
    spawnGrace.delete(chatId);
    return false;
  }
  return true;
}

const CONNECTION_ERROR_PATTERNS: { pattern: RegExp; message: string }[] = [
  { pattern: /pairing required/i, message: 'Device pairing required. Run `openclaw devices approve --latest` in your terminal.' },
  { pattern: /device signature invalid/i, message: 'Device signature invalid. Your OpenClaw CLI and gateway may be different versions.' },
  { pattern: /gateway connect failed/i, message: 'Gateway connection failed. Check that your OpenClaw gateway is running.' },
];

/** Detect connection errors (pairing, auth, gateway) in terminal output. */
export function detectConnectionError(text: string): string | null {
  const clean = stripAnsi(text);
  const lines = clean.split('\n').filter((l) => l.trim()).slice(-10).join('\n');
  for (const { pattern, message } of CONNECTION_ERROR_PATTERNS) {
    if (pattern.test(lines)) return message;
  }
  return null;
}

/** Detect action-required patterns (permission prompts, Y/n, etc.) in terminal output. */
export function detectActionRequired(text: string): boolean {
  const clean = stripAnsi(text);
  // Only check the last 5 non-empty lines — a real prompt is always at
  // the cursor (bottom of output). Checking more causes false positives
  // when the agent's conversational text mentions prompts/patterns.
  const lines = clean.split('\n').filter((l) => l.trim()).slice(-5).join('\n');
  return ACTION_REQUIRED_PATTERNS.some((p) => p.test(lines));
}
