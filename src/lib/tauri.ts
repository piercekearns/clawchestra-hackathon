import { invoke } from '@tauri-apps/api/core';
import type { GitStatus } from './schema';
import type { DashboardSettings } from './settings';

type UpdateStatus = {
  update_available: boolean;
  build_commit: string;
  current_commit: string | null;
};

type TauriSlashCommand = {
  name: string;
  desc: string;
  category: string;
  source?: string;
};

export type RepoProbe = {
  isGitRepo: boolean;
  gitBranch?: string;
  gitRemote?: string;
  isWorkingTreeDirty?: boolean;
  dirtyPaths: string[];
};

export type ScanResult = {
  projects: string[];
  skipped: SkippedDirectory[];
};

export type SkippedDirectory = {
  path: string;
  reason: string;
};

type TauriCommands = {
  get_dashboard_settings: { args: Record<string, never>; return: DashboardSettings };
  update_dashboard_settings: { args: { settings: DashboardSettings }; return: DashboardSettings };
  scan_projects: { args: { scanPaths: string[] }; return: ScanResult };
  get_openclaw_gateway_config: {
    args: Record<string, never>;
    return: { ws_url: string; token?: string; session_key: string };
  };
  openclaw_ping: { args: Record<string, never>; return: void };
  openclaw_chat: {
    args: {
      message: string;
      attachments: Array<{ name?: string; mimeType: string; content: string }>;
      sessionKey?: string;
    };
    return: string;
  };
  read_file: { args: { path: string }; return: string };
  write_file: { args: { path: string; content: string }; return: void };
  delete_file: { args: { path: string }; return: void };
  remove_path: { args: { path: string }; return: void };
  resolve_path: { args: { path: string }; return: string };
  path_exists: { args: { path: string }; return: boolean };
  create_directory: { args: { path: string }; return: void };
  pick_folder: { args: { initialPath?: string | null }; return: string | null };
  probe_repo: { args: { repoPath: string }; return: RepoProbe };
  get_git_status: { args: { repoPath: string }; return: GitStatus };
  git_commit: {
    args: { repoPath: string; message: string; files: string[] };
    return: void;
  };
  git_push: { args: { repoPath: string }; return: void };
  git_init_repo: {
    args: { repoPath: string; initialCommit: boolean; files: string[] };
    return: void;
  };
  check_for_update: { args: Record<string, never>; return: UpdateStatus };
  run_app_update: { args: Record<string, never>; return: string };
  list_slash_commands: { args: Record<string, never>; return: TauriSlashCommand[] };
  // Chat persistence commands
  chat_messages_load: {
    args: { beforeTimestamp?: number; beforeId?: string; limit?: number };
    return: Array<{ id: string; role: string; content: string; timestamp: number; metadata?: string }>;
  };
  chat_message_save: {
    args: { message: { id: string; role: string; content: string; timestamp: number; metadata?: string } };
    return: void;
  };
  chat_messages_clear: { args: Record<string, never>; return: void };
  chat_messages_count: { args: Record<string, never>; return: number };
  chat_pending_turn_save: {
    args: {
      turn: {
        turnToken: string;
        sessionKey: string;
        runId?: string;
        status: string;
        submittedAt: number;
        lastSignalAt: number;
        completedAt?: number;
        hasAssistantOutput: boolean;
        completionReason?: string;
      };
    };
    return: void;
  };
  chat_pending_turn_remove: { args: { turnToken: string }; return: void };
  chat_pending_turns_load: {
    args: { sessionKey?: string };
    return: Array<{
      turnToken: string;
      sessionKey: string;
      runId?: string;
      status: string;
      submittedAt: number;
      lastSignalAt: number;
      completedAt?: number;
      hasAssistantOutput: boolean;
      completionReason?: string;
    }>;
  };
};

export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

async function typedInvoke<T extends keyof TauriCommands>(
  cmd: T,
  ...args: TauriCommands[T]['args'] extends Record<string, never>
    ? []
    : [args: TauriCommands[T]['args']]
): Promise<TauriCommands[T]['return']> {
  if (!isTauriRuntime()) {
    throw new Error('Tauri runtime is required for filesystem operations. Use `pnpm tauri:dev`.');
  }

  return invoke<TauriCommands[T]['return']>(cmd, args[0]);
}

export async function scanProjects(scanPaths: string[]): Promise<ScanResult> {
  return typedInvoke('scan_projects', { scanPaths });
}

export async function getDashboardSettings(): Promise<DashboardSettings> {
  return typedInvoke('get_dashboard_settings');
}

export async function updateDashboardSettings(settings: DashboardSettings): Promise<DashboardSettings> {
  return typedInvoke('update_dashboard_settings', { settings });
}

export async function getOpenClawGatewayConfig(): Promise<{
  wsUrl: string;
  token?: string;
  sessionKey: string;
}> {
  const result = await typedInvoke('get_openclaw_gateway_config');
  return {
    wsUrl: result.ws_url,
    token: result.token,
    sessionKey: result.session_key,
  };
}

export async function checkOpenClawGatewayConnection(): Promise<boolean> {
  try {
    await typedInvoke('openclaw_ping');
    return true;
  } catch {
    return false;
  }
}

export async function sendOpenClawMessage(args: {
  message: string;
  attachments: Array<{ name?: string; mimeType: string; content: string }>;
  sessionKey?: string;
}): Promise<string> {
  return typedInvoke('openclaw_chat', args);
}

export async function readFile(path: string): Promise<string> {
  return typedInvoke('read_file', { path });
}

export async function writeFile(path: string, content: string): Promise<void> {
  return typedInvoke('write_file', { path, content });
}

export async function deleteFile(path: string): Promise<void> {
  return typedInvoke('delete_file', { path });
}

export async function removePath(path: string): Promise<void> {
  return typedInvoke('remove_path', { path });
}

export async function resolvePath(path: string): Promise<string> {
  return typedInvoke('resolve_path', { path });
}

export async function pathExists(path: string): Promise<boolean> {
  return typedInvoke('path_exists', { path });
}

export async function createDirectory(path: string): Promise<void> {
  return typedInvoke('create_directory', { path });
}

export async function pickFolder(initialPath?: string | null): Promise<string | null> {
  return typedInvoke('pick_folder', { initialPath: initialPath ?? null });
}

export async function probeRepo(repoPath: string): Promise<RepoProbe> {
  return typedInvoke('probe_repo', { repoPath });
}

export async function getGitStatus(repoPath: string): Promise<GitStatus> {
  return typedInvoke('get_git_status', { repoPath });
}

export async function gitCommit(repoPath: string, message: string, files: string[]): Promise<void> {
  return typedInvoke('git_commit', { repoPath, message, files });
}

export async function gitPush(repoPath: string): Promise<void> {
  return typedInvoke('git_push', { repoPath });
}

export async function gitInitRepo(
  repoPath: string,
  initialCommit: boolean,
  files: string[],
): Promise<void> {
  return typedInvoke('git_init_repo', { repoPath, initialCommit, files });
}

export async function checkForUpdate(): Promise<UpdateStatus> {
  return typedInvoke('check_for_update');
}

export async function runAppUpdate(): Promise<string> {
  return typedInvoke('run_app_update');
}

export async function listSlashCommands(): Promise<TauriSlashCommand[]> {
  return typedInvoke('list_slash_commands');
}

// =============================================================================
// Chat Persistence
// =============================================================================

export interface PersistedChatMessage {
  id: string;
  role: string;
  content: string;
  timestamp: number;
  metadata?: string;
}

export interface PersistedPendingTurn {
  turnToken: string;
  sessionKey: string;
  runId?: string;
  status: string;
  submittedAt: number;
  lastSignalAt: number;
  completedAt?: number;
  hasAssistantOutput: boolean;
  completionReason?: string;
}

export async function chatMessagesLoad(
  beforeTimestamp?: number,
  limit?: number,
  beforeId?: string,
): Promise<PersistedChatMessage[]> {
  return typedInvoke('chat_messages_load', { beforeTimestamp, beforeId, limit });
}

export async function chatMessageSave(message: PersistedChatMessage): Promise<void> {
  return typedInvoke('chat_message_save', { message });
}

export async function chatMessagesClear(): Promise<void> {
  return typedInvoke('chat_messages_clear');
}

export async function chatMessagesCount(): Promise<number> {
  return typedInvoke('chat_messages_count');
}

export async function chatPendingTurnSave(turn: PersistedPendingTurn): Promise<void> {
  return typedInvoke('chat_pending_turn_save', { turn });
}

export async function chatPendingTurnRemove(turnToken: string): Promise<void> {
  return typedInvoke('chat_pending_turn_remove', { turnToken });
}

export async function chatPendingTurnsLoad(sessionKey?: string): Promise<PersistedPendingTurn[]> {
  return typedInvoke('chat_pending_turns_load', { sessionKey });
}
