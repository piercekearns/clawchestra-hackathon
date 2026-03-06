export function buildRemoteSystemContextContent(): string {
  return [
    'You are integrated with Clawchestra, a project orchestration tool.',
    '',
    'Database: ~/.openclaw/clawchestra/db.json',
    'Format: JSON (schema below)',
    '',
    'Schema rules:',
    '- Project statuses: in-progress | up-next | pending | dormant | archived',
    '- Roadmap item statuses: pending | up-next | in-progress | complete | archived',
    '- completedAt required when status is complete',
    '- Priorities unique per column',
    '',
    'When asked about projects, roadmap items, or task status, read the database.',
    'When making changes, write to the database. Sync is automatic.',
    '',
    'Note: Data reflects the last time Clawchestra synced. For real-time status, check the Clawchestra app directly.',
    '',
    'This system context was installed for a remote OpenClaw host by Clawchestra.',
  ].join('\n');
}

export function buildRemoteOpenclawInstallScript(args: {
  bearerToken: string;
  extensionContent: string;
  systemContextContent?: string;
}): string {
  const settingsJson = JSON.stringify({ bearerToken: args.bearerToken }, null, 2);
  const systemContext = args.systemContextContent ?? buildRemoteSystemContextContent();

  return [
    'set -eu',
    '',
    'OPENCLAW_ROOT="$HOME/.openclaw"',
    'CLAWCHESTRA_DIR="$OPENCLAW_ROOT/clawchestra"',
    'EXTENSIONS_DIR="$OPENCLAW_ROOT/extensions"',
    '',
    'mkdir -p "$CLAWCHESTRA_DIR" "$EXTENSIONS_DIR"',
    '',
    'cat > "$CLAWCHESTRA_DIR/settings.json" <<\'__CLAWCHESTRA_SETTINGS__\'',
    settingsJson,
    '__CLAWCHESTRA_SETTINGS__',
    '',
    'cat > "$EXTENSIONS_DIR/clawchestra-data-endpoint.ts" <<\'__CLAWCHESTRA_EXTENSION__\'',
    args.extensionContent,
    '__CLAWCHESTRA_EXTENSION__',
    '',
    'cat > "$CLAWCHESTRA_DIR/system-context.md" <<\'__CLAWCHESTRA_CONTEXT__\'',
    systemContext,
    '__CLAWCHESTRA_CONTEXT__',
    '',
    'printf "Clawchestra remote support installed at %s\\n" "$OPENCLAW_ROOT"',
    'printf "Restart OpenClaw if it is already running, then return to Clawchestra and test the connection.\\n"',
  ].join('\n');
}
