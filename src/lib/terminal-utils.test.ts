import { describe, expect, it } from 'bun:test';
import { getAgentLaunchSpec } from './terminal-utils';
import type { DetectedAgent } from './tauri';

describe('getAgentLaunchSpec', () => {
  it('prefers a resolved executable path when no shell mediation is needed', () => {
    const detectedAgents: DetectedAgent[] = [
      {
        agentType: 'codex',
        command: 'codex',
        path: '/opt/homebrew/bin/codex',
        available: true,
        prefersShell: false,
        shellPath: '/bin/zsh',
      },
    ];

    expect(getAgentLaunchSpec('codex', detectedAgents)).toEqual({
      command: '/opt/homebrew/bin/codex',
      prefersShell: false,
      shellPath: '/bin/zsh',
    });
  });

  it('prefers the bare command when the agent is shell-defined', () => {
    const detectedAgents: DetectedAgent[] = [
      {
        agentType: 'codex',
        command: 'codex',
        path: null,
        available: true,
        prefersShell: true,
        shellPath: '/bin/zsh',
      },
    ];

    expect(getAgentLaunchSpec('codex', detectedAgents)).toEqual({
      command: 'codex',
      prefersShell: true,
      shellPath: '/bin/zsh',
    });
  });

  it('preserves subcommands when shell mediation is required', () => {
    const detectedAgents: DetectedAgent[] = [
      {
        agentType: 'openclaw-tui',
        command: 'openclaw',
        path: null,
        available: true,
        prefersShell: true,
        shellPath: '/bin/zsh',
      },
    ];

    expect(getAgentLaunchSpec('openclaw-tui', detectedAgents)).toEqual({
      command: 'openclaw tui',
      prefersShell: true,
      shellPath: '/bin/zsh',
    });
  });
});
