import { describe, expect, it } from 'bun:test';
import { buildTerminalLaunchPlan } from './terminal-launch';
import type { TerminalDependencyStatus } from './tauri';

const baseDependencyStatus: TerminalDependencyStatus = {
  platform: 'macos',
  tmuxAvailable: true,
  tmuxPath: '/opt/homebrew/bin/tmux',
  shellPath: '/bin/zsh',
  installerLabel: 'Install tmux with Homebrew',
  installerCommand: '"/opt/homebrew/bin/brew" install tmux',
  installerNote: 'tmux-backed terminals keep sessions alive when you close the drawer or relaunch the app.',
};

describe('buildTerminalLaunchPlan', () => {
  it('launches shell-defined POSIX agents through tmux with the user shell configured', () => {
    const plan = buildTerminalLaunchPlan({
      platform: 'macos',
      sessionName: 'clawchestra:proj:chat',
      agentCommand: 'codex',
      agentPrefersShell: true,
      agentShellPath: '/bin/zsh',
      tmuxPath: '/opt/homebrew/bin/tmux',
      projectDirPath: '/workspace/project',
      dependencyStatus: baseDependencyStatus,
      modeOverride: 'auto',
    });

    expect(plan.command).toBe('sh');
    expect(plan.args[1]).toContain("set -g default-shell '/bin/zsh'");
    expect(plan.args[1]).toContain("send-keys 'codex' Enter");
  });

  it('launches shell-defined POSIX agents through the user shell when tmux is missing', () => {
    const plan = buildTerminalLaunchPlan({
      platform: 'macos',
      sessionName: 'clawchestra:proj:chat',
      agentCommand: 'codex',
      agentPrefersShell: true,
      agentShellPath: '/bin/zsh',
      tmuxPath: null,
      projectDirPath: '/workspace/project',
      dependencyStatus: { ...baseDependencyStatus, tmuxAvailable: false, tmuxPath: null },
      modeOverride: 'auto',
    });

    expect(plan.command).toBe('/bin/zsh');
    expect(plan.args).toEqual(['-i', '-l', '-c', 'codex']);
  });

  it('keeps direct executable launches for non-shell-defined agents', () => {
    const plan = buildTerminalLaunchPlan({
      platform: 'macos',
      sessionName: 'clawchestra:proj:chat',
      agentCommand: '/opt/homebrew/bin/codex',
      agentPrefersShell: false,
      agentShellPath: '/bin/zsh',
      tmuxPath: null,
      projectDirPath: '/workspace/project',
      dependencyStatus: { ...baseDependencyStatus, tmuxAvailable: false, tmuxPath: null },
      modeOverride: 'auto',
    });

    expect(plan.command).toBe('sh');
    expect(plan.args).toEqual(['-lc', "exec '/opt/homebrew/bin/codex'"]);
  });

  it('launches shell-defined Windows agents as bare commands inside PowerShell', () => {
    const plan = buildTerminalLaunchPlan({
      platform: 'windows',
      sessionName: 'clawchestra:proj:chat',
      agentCommand: 'codex',
      agentPrefersShell: true,
      agentShellPath: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
      tmuxPath: null,
      projectDirPath: 'C:\\workspace\\project',
      dependencyStatus: {
        platform: 'windows',
        tmuxAvailable: false,
        tmuxPath: null,
        shellPath: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
        installerLabel: null,
        installerCommand: null,
        installerNote: 'Windows terminals currently fall back to direct PowerShell sessions.',
      },
      modeOverride: 'auto',
    });

    expect(plan.command).toBe('C:\\Program Files\\PowerShell\\7\\pwsh.exe');
    expect(plan.args).toEqual(['-NoLogo', '-NoExit', '-Command', 'codex']);
  });
});
