import type { HubAgentType } from './hub-types';
import type { DetectedAgent } from './tauri';

export type AgentLaunchSpec = {
  command: string | null;
  prefersShell: boolean;
  shellPath: string | null;
};

/** Map agent type to the CLI command that launches it.
 *  When `detectedAgents` is provided, prefers the resolved absolute path
 *  (e.g. `/opt/homebrew/bin/claude`) unless the command is shell-defined and
 *  should be invoked through the user's shell to honor aliases/functions. */
export function getAgentLaunchSpec(
  agentType: HubAgentType | null,
  detectedAgents?: DetectedAgent[],
): AgentLaunchSpec {
  if (!agentType || agentType === 'generic' || agentType === 'cursor') {
    return { command: null, prefersShell: false, shellPath: null };
  }

  // Subcommands appended after the resolved binary path
  const subcommands: Partial<Record<HubAgentType, string>> = {
    'openclaw-tui': 'tui',
  };

  // Use resolved absolute path from detection when available
  if (detectedAgents) {
    // openclaw-tui detects via the 'openclaw-tui' agent type entry
    const agent = detectedAgents.find((a) => a.agentType === agentType && a.available);
    if (agent) {
      const base = agent.prefersShell ? agent.command : agent.path;
      if (base) {
        const sub = subcommands[agentType];
        return {
          command: sub ? `${base} ${sub}` : base,
          prefersShell: agent.prefersShell,
          shellPath: agent.shellPath,
        };
      }
    }

    if (agent?.path) {
      const sub = subcommands[agentType];
      return {
        command: sub ? `${agent.path} ${sub}` : agent.path,
        prefersShell: false,
        shellPath: agent.shellPath,
      };
    }
  }

  // Fallback to bare command name
  const sub = subcommands[agentType];
  switch (agentType) {
    case 'claude-code':
      return { command: 'claude', prefersShell: false, shellPath: null };
    case 'codex':
      return { command: 'codex', prefersShell: false, shellPath: null };
    case 'opencode':
      return { command: 'opencode', prefersShell: false, shellPath: null };
    case 'openclaw-tui':
      return {
        command: sub ? `openclaw ${sub}` : 'openclaw',
        prefersShell: false,
        shellPath: null,
      };
    default:
      return { command: null, prefersShell: false, shellPath: null };
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
  'openclaw-tui': 'OpenClaw TUI',
  cursor: 'Cursor',
  generic: 'Terminal',
};
