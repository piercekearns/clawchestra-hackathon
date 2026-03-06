import type { TerminalDependencyStatus } from './tauri';

export type RuntimeMode = 'tmux' | 'direct' | 'install' | 'persistent-direct';

export type RuntimeNotice = {
  tone: 'info' | 'warning';
  title: string;
  body: string;
  allowInstall: boolean;
};

export type LaunchPlan = {
  mode: RuntimeMode;
  persistent: boolean;
  command: string | null;
  args: string[];
  notice: RuntimeNotice | null;
  writeLines: string[];
};

type BuildTerminalLaunchPlanArgs = {
  platform: string;
  sessionName: string;
  agentCommand: string | null;
  agentPrefersShell: boolean;
  agentShellPath: string | null;
  tmuxPath: string | null;
  projectDirPath: string | undefined;
  dependencyStatus: TerminalDependencyStatus | null;
  modeOverride: 'auto' | 'install-tmux';
};

function escapePosixShell(value: string): string {
  return value.replace(/'/g, "'\\''");
}

function shellBasename(shellPath: string): string {
  const normalized = shellPath.replace(/\\/g, '/');
  const segments = normalized.split('/');
  return (segments[segments.length - 1] ?? '').toLowerCase();
}

function buildPosixCommandShellArgs(shellPath: string, command: string): string[] {
  const shell = shellBasename(shellPath);
  if (shell === 'sh' || shell === 'dash') {
    return ['-i', '-c', command];
  }

  return ['-i', '-l', '-c', command];
}

function buildPosixInteractiveShellArgs(shellPath: string): string[] {
  const shell = shellBasename(shellPath);
  if (shell === 'sh' || shell === 'dash') {
    return ['-i'];
  }

  return ['-i', '-l'];
}

function formatPosixAgentCommand(command: string): string {
  if (command.endsWith(' tui')) {
    const binary = command.slice(0, -4).trim();
    return `exec '${escapePosixShell(binary)}' tui`;
  }

  return `exec '${escapePosixShell(command.trim())}'`;
}

function formatWindowsAgentCommand(command: string): string {
  if (command.endsWith(' tui')) {
    const binary = command.slice(0, -4).trim().replace(/"/g, '`"');
    return `& "${binary}" tui`;
  }

  return `& "${command.trim().replace(/"/g, '`"')}"`;
}

export function buildTmuxShellCommand(
  tmux: string,
  sessionName: string,
  agentCommand: string | null,
  shellPath: string | null,
): string {
  const tmuxSessionSanitized = sessionName.replace(/:/g, '_');
  const captureCmd = `${tmux} -L clawchestra capture-pane -t '${tmuxSessionSanitized}' -p -e -S -5000 2>/dev/null`;
  const hasSessionCheck = `${tmux} -L clawchestra has-session -t '${tmuxSessionSanitized}' 2>/dev/null && IS_REATTACH=1 || IS_REATTACH=0`;
  const tmuxCommands = [
    ...(shellPath ? [`set -g default-shell '${escapePosixShell(shellPath)}'`] : []),
    `new-session -A -s '${sessionName}'`,
    'set status off',
    'set history-limit 50000',
    'set remain-on-exit on',
    "set -ga terminal-overrides ',xterm-256color:smcup@:rmcup@'",
  ];
  const [firstCommand, ...remainingCommands] = tmuxCommands;
  const tmuxBase = `${tmux} -u -f /dev/null -L clawchestra ${firstCommand}${remainingCommands.map((segment) => ` \\; ${segment}`).join('')}`;

  if (agentCommand) {
    const escapedCmd = escapePosixShell(agentCommand);
    return [
      captureCmd,
      hasSessionCheck,
      `if [ "$IS_REATTACH" = "0" ]; then exec ${tmuxBase} \\; send-keys '${escapedCmd}' Enter; else exec ${tmuxBase}; fi`,
    ].join('; ');
  }

  return `${captureCmd}; exec ${tmuxBase}`;
}

export function buildTerminalLaunchPlan(args: BuildTerminalLaunchPlanArgs): LaunchPlan {
  const {
    platform,
    sessionName,
    agentCommand,
    agentPrefersShell,
    agentShellPath,
    tmuxPath,
    projectDirPath,
    dependencyStatus,
    modeOverride,
  } = args;
  const preferredShellPath = agentShellPath ?? dependencyStatus?.shellPath ?? null;

  if (modeOverride === 'install-tmux') {
    if (!dependencyStatus?.installerCommand) {
      return {
        mode: 'install',
        persistent: false,
        command: null,
        args: [],
        notice: {
          tone: 'warning',
          title: 'Automatic tmux install unavailable',
          body: dependencyStatus?.installerNote
            ?? 'Clawchestra could not find a supported package manager for a one-click tmux install.',
          allowInstall: false,
        },
        writeLines: ['[Terminal remediation] No automatic tmux install path is available on this platform.'],
      };
    }

    const installCommand = `${dependencyStatus.installerCommand}; status=$?; printf '\\n[Clawchestra] tmux install exited with code %s.\\n' "$status"; exit $status`;
    return {
      mode: 'install',
      persistent: false,
      command: 'sh',
      args: ['-lc', installCommand],
      notice: {
        tone: 'info',
        title: dependencyStatus.installerLabel ?? 'Installing tmux',
        body: 'This runs inside a temporary shell. If your package manager prompts for confirmation or a password, respond here.',
        allowInstall: false,
      },
      writeLines: [],
    };
  }

  if (!projectDirPath) {
    return {
      mode: 'direct',
      persistent: false,
      command: null,
      args: [],
      notice: {
        tone: 'warning',
        title: 'Project path missing',
        body: 'Clawchestra cannot open this terminal in the correct working directory until the project path is restored.',
        allowInstall: false,
      },
      writeLines: ['[Terminal unavailable] Project path is missing, so Clawchestra cannot open the shell in the correct working directory.'],
    };
  }

  if (platform === 'windows') {
    const shellPath = preferredShellPath ?? 'powershell.exe';
    return {
      mode: 'persistent-direct',
      persistent: true,
      command: shellPath,
      args: agentCommand
        ? ['-NoLogo', '-NoExit', '-Command', agentPrefersShell ? agentCommand : formatWindowsAgentCommand(agentCommand)]
        : ['-NoLogo'],
      notice: {
        tone: 'info',
        title: 'Persistent Windows terminal',
        body: 'Windows terminals now use a local background host so sessions can survive drawer close and Clawchestra relaunch.',
        allowInstall: false,
      },
      writeLines: [],
    };
  }

  if (tmuxPath) {
    return {
      mode: 'tmux',
      persistent: true,
      command: 'sh',
      args: ['-c', buildTmuxShellCommand(tmuxPath, sessionName, agentCommand, preferredShellPath)],
      notice: null,
      writeLines: [],
    };
  }

  if (agentCommand) {
    if (agentPrefersShell && preferredShellPath) {
      return {
        mode: 'direct',
        persistent: false,
        command: preferredShellPath,
        args: buildPosixCommandShellArgs(preferredShellPath, agentCommand),
        notice: {
          tone: 'warning',
          title: 'tmux missing: running a temporary session',
          body: `${dependencyStatus?.installerNote ?? 'tmux is required for persistent embedded terminals.'} This session will stop when you close the drawer or switch away.`,
          allowInstall: Boolean(dependencyStatus?.installerCommand),
        },
        writeLines: [],
      };
    }

    return {
      mode: 'direct',
      persistent: false,
      command: 'sh',
      args: ['-lc', formatPosixAgentCommand(agentCommand)],
      notice: {
        tone: 'warning',
        title: 'tmux missing: running a temporary session',
        body: `${dependencyStatus?.installerNote ?? 'tmux is required for persistent embedded terminals.'} This session will stop when you close the drawer or switch away.`,
        allowInstall: Boolean(dependencyStatus?.installerCommand),
      },
      writeLines: [],
    };
  }

  const shellPath = preferredShellPath ?? 'sh';
  return {
    mode: 'direct',
    persistent: false,
    command: shellPath,
    args: buildPosixInteractiveShellArgs(shellPath),
    notice: {
      tone: 'warning',
      title: 'tmux missing: running a temporary session',
      body: `${dependencyStatus?.installerNote ?? 'tmux is required for persistent embedded terminals.'} This session will stop when you close the drawer or switch away.`,
      allowInstall: Boolean(dependencyStatus?.installerCommand),
    },
    writeLines: [],
  };
}
