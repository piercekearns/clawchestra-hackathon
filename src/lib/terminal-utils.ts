import type { HubAgentType } from './hub-types';
import type { DetectedAgent } from './tauri';

/** Map agent type to the CLI command that launches it.
 *  When `detectedAgents` is provided, returns the resolved absolute path
 *  (e.g. `/opt/homebrew/bin/claude`) so the command works regardless of
 *  the tmux session's PATH. Falls back to the bare command name. */
export function getAgentCommand(
  agentType: HubAgentType | null,
  detectedAgents?: DetectedAgent[],
): string | null {
  if (!agentType || agentType === 'generic' || agentType === 'cursor') return null;

  // Use resolved absolute path from detection when available
  if (detectedAgents) {
    const agent = detectedAgents.find((a) => a.agentType === agentType && a.available);
    if (agent?.path) return agent.path;
  }

  // Fallback to bare command name
  switch (agentType) {
    case 'claude-code':
      return 'claude';
    case 'codex':
      return 'codex';
    case 'opencode':
      return 'opencode';
    default:
      return null;
  }
}

/** Build a deterministic tmux session name for a terminal chat. */
export function tmuxSessionName(projectId: string, chatId: string): string {
  return `clawchestra:${projectId}:${chatId}`;
}

/** Parse a tmux session name back into projectId and chatId.
 *
 *  tmux sanitizes colons to underscores in stored session names, so we handle
 *  both `clawchestra:proj:chatId` (original) and `clawchestra_proj_chatId`
 *  (sanitized). For the underscore form, we find the UUID chatId boundary
 *  using the 8-4-4-4-12 hex pattern. */
export function parseTmuxSessionName(name: string): { projectId: string; chatId: string } | null {
  // Try colon-delimited first (original format)
  const colonParts = name.split(':');
  if (colonParts.length >= 3 && colonParts[0] === 'clawchestra') {
    return { projectId: colonParts[1], chatId: colonParts.slice(2).join(':') };
  }

  // Try underscore-sanitized format: clawchestra_<projectId>_<uuid-chatId>
  // UUID pattern: 8-4-4-4-12 hex chars with hyphens
  const uuidMatch = name.match(/^clawchestra_(.+)_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
  if (uuidMatch) {
    return { projectId: uuidMatch[1], chatId: uuidMatch[2] };
  }

  return null;
}

/** Human-readable labels for agent types. */
export const AGENT_LABELS: Record<HubAgentType, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  opencode: 'OpenCode',
  cursor: 'Cursor',
  generic: 'Shell',
};
