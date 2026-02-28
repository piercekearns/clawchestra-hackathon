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

/** Parse a tmux session name back into projectId and chatId. */
export function parseTmuxSessionName(name: string): { projectId: string; chatId: string } | null {
  const parts = name.split(':');
  if (parts.length < 3 || parts[0] !== 'clawchestra') return null;
  return { projectId: parts[1], chatId: parts.slice(2).join(':') };
}

/** Human-readable labels for agent types. */
export const AGENT_LABELS: Record<HubAgentType, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  opencode: 'OpenCode',
  cursor: 'Cursor',
  generic: 'Shell',
};
