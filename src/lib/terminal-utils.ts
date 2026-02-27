import type { HubAgentType } from './hub-types';

/** Map agent type to the CLI command that launches it. */
export function getAgentCommand(agentType: HubAgentType | null): string | null {
  switch (agentType) {
    case 'claude-code':
      return 'claude';
    case 'codex':
      return 'codex';
    case 'opencode':
      return 'opencode';
    case 'generic':
    case 'cursor':
    case null:
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
