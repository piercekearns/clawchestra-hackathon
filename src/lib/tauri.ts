import { invoke } from '@tauri-apps/api/core';
import type {
  GitBranchState,
  GitConflictApplyResult,
  GitConflictFileContext,
  GitConflictResolutionInput,
  GitCherryPickResult,
  GitResumeValidation,
  GitStashResult,
  GitStatus,
} from './schema';
import type { DashboardSettings } from './settings';

type UpdateStatus = {
  update_available: boolean;
  build_commit: string;
  current_commit: string | null;
};

export type UpdateLockState = {
  lockPresent: boolean;
  processAlive: boolean;
  stale: boolean;
  ageSecs: number | null;
};

export type UpdateGuardInput = {
  activeTurnCount: number;
  enforceFlushGuard: boolean;
  allowForce: boolean;
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
  git_fetch: { args: { repoPath: string }; return: string };
  git_get_branch_states: { args: { repoPath: string }; return: GitBranchState[] };
  git_commit: {
    args: { repoPath: string; message: string; files: string[] };
    return: string;
  };
  git_push: { args: { repoPath: string }; return: void };
  git_sync_lock_acquire: { args: { repoPath: string }; return: string };
  git_sync_lock_release: { args: { repoPath: string; token: string }; return: void };
  git_checkout_branch: { args: { repoPath: string; branch: string }; return: void };
  git_stash_push: {
    args: { repoPath: string; includeUntracked: boolean; message?: string | null };
    return: GitStashResult;
  };
  git_pop_stash: { args: { repoPath: string; stashRef?: string | null }; return: void };
  git_cherry_pick_commit: {
    args: { repoPath: string; commitHash: string };
    return: GitCherryPickResult;
  };
  git_abort_cherry_pick: { args: { repoPath: string }; return: void };
  git_pull_current: { args: { repoPath: string }; return: void };
  git_get_conflict_context: { args: { repoPath: string }; return: GitConflictFileContext[] };
  git_apply_conflict_resolution: {
    args: { repoPath: string; resolutions: GitConflictResolutionInput[] };
    return: GitConflictApplyResult;
  };
  git_validate_branch_sync_resume: {
    args: {
      repoPath: string;
      sourceBranch: string;
      commitHash: string;
      remainingTargets: string[];
    };
    return: GitResumeValidation;
  };
  git_init_repo: {
    args: { repoPath: string; initialCommit: boolean; files: string[] };
    return: void;
  };
  check_for_update: { args: Record<string, never>; return: UpdateStatus };
  get_app_update_lock_state: { args: Record<string, never>; return: UpdateLockState };
  run_app_update: { args: { updateGuard?: UpdateGuardInput | null }; return: string };
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
  chat_flush: { args: Record<string, never>; return: void };
  chat_recovery_cursor_get: {
    args: { sessionKey?: string };
    return: {
      sessionKey: string;
      lastMessageId?: string;
      lastTimestamp: number;
      updatedAt: number;
    } | null;
  };
  chat_recovery_cursor_advance: {
    args: { sessionKey: string; lastTimestamp: number; lastMessageId?: string };
    return: void;
  };
  chat_recovery_cursor_clear: {
    args: { sessionKey?: string };
    return: void;
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

export async function gitFetch(repoPath: string): Promise<string> {
  return typedInvoke('git_fetch', { repoPath });
}

export async function gitGetBranchStates(repoPath: string): Promise<GitBranchState[]> {
  return typedInvoke('git_get_branch_states', { repoPath });
}

export async function gitCommit(repoPath: string, message: string, files: string[]): Promise<string> {
  return typedInvoke('git_commit', { repoPath, message, files });
}

export async function gitPush(repoPath: string): Promise<void> {
  return typedInvoke('git_push', { repoPath });
}

export async function gitSyncLockAcquire(repoPath: string): Promise<string> {
  return typedInvoke('git_sync_lock_acquire', { repoPath });
}

export async function gitSyncLockRelease(repoPath: string, token: string): Promise<void> {
  return typedInvoke('git_sync_lock_release', { repoPath, token });
}

export async function gitCheckoutBranch(repoPath: string, branch: string): Promise<void> {
  return typedInvoke('git_checkout_branch', { repoPath, branch });
}

export async function gitStashPush(
  repoPath: string,
  includeUntracked: boolean,
  message?: string | null,
): Promise<GitStashResult> {
  return typedInvoke('git_stash_push', { repoPath, includeUntracked, message: message ?? null });
}

export async function gitPopStash(repoPath: string, stashRef?: string | null): Promise<void> {
  return typedInvoke('git_pop_stash', { repoPath, stashRef: stashRef ?? null });
}

export async function gitCherryPickCommit(repoPath: string, commitHash: string): Promise<GitCherryPickResult> {
  return typedInvoke('git_cherry_pick_commit', { repoPath, commitHash });
}

export async function gitAbortCherryPick(repoPath: string): Promise<void> {
  return typedInvoke('git_abort_cherry_pick', { repoPath });
}

export async function gitPullCurrent(repoPath: string): Promise<void> {
  return typedInvoke('git_pull_current', { repoPath });
}

export async function gitGetConflictContext(repoPath: string): Promise<GitConflictFileContext[]> {
  return typedInvoke('git_get_conflict_context', { repoPath });
}

export async function gitApplyConflictResolution(
  repoPath: string,
  resolutions: GitConflictResolutionInput[],
): Promise<GitConflictApplyResult> {
  return typedInvoke('git_apply_conflict_resolution', { repoPath, resolutions });
}

export async function gitValidateBranchSyncResume(args: {
  repoPath: string;
  sourceBranch: string;
  commitHash: string;
  remainingTargets: string[];
}): Promise<GitResumeValidation> {
  return typedInvoke('git_validate_branch_sync_resume', args);
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

export async function getAppUpdateLockState(): Promise<UpdateLockState> {
  return typedInvoke('get_app_update_lock_state');
}

export async function runAppUpdate(updateGuard?: UpdateGuardInput): Promise<string> {
  return typedInvoke('run_app_update', { updateGuard: updateGuard ?? null });
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

export interface PersistedRecoveryCursor {
  sessionKey: string;
  lastMessageId?: string;
  lastTimestamp: number;
  updatedAt: number;
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

export async function chatFlush(): Promise<void> {
  return typedInvoke('chat_flush');
}

export async function chatRecoveryCursorGet(sessionKey?: string): Promise<PersistedRecoveryCursor | null> {
  return typedInvoke('chat_recovery_cursor_get', { sessionKey });
}

export async function chatRecoveryCursorAdvance(
  sessionKey: string,
  lastTimestamp: number,
  lastMessageId?: string,
): Promise<void> {
  return typedInvoke('chat_recovery_cursor_advance', { sessionKey, lastTimestamp, lastMessageId });
}

export async function chatRecoveryCursorClear(sessionKey?: string): Promise<void> {
  return typedInvoke('chat_recovery_cursor_clear', { sessionKey });
}
