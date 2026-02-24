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
import type { ProjectSummary, ProjectWithContent } from './state-json';

export type SyncResult = {
  success: boolean;
  message: string;
  warnings: string[];
  fieldsFromRemote: number;
  fieldsFromLocal: number;
};

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

/** Partial update payload for a roadmap item — only fields that are present are applied. */
export type RoadmapItemChanges = {
  title?: string;
  status?: string;
  priority?: number;
  nextAction?: string;
  tags?: string[];
  icon?: string;
  blockedBy?: string;
  specDoc?: string;
  planDoc?: string;
  completedAt?: string;
};

export type BatchReorderItemChange = {
  itemId: string;
  newPriority: number;
  newStatus?: string | null;
};

type TauriCommands = {
  get_dashboard_settings: { args: Record<string, never>; return: DashboardSettings };
  update_dashboard_settings: { args: { settings: DashboardSettings }; return: DashboardSettings };
  scan_projects: { args: { scanPaths: string[] }; return: ScanResult };
  get_openclaw_gateway_config: {
    args: Record<string, never>;
    return: { ws_url: string; token?: string; session_key: string };
  };
  get_openclaw_ws_device_auth: {
    args: {
      nonce: string;
      clientId: string;
      clientMode: string;
      role: string;
      scopes: string[];
      token?: string | null;
    };
    return: {
      id: string;
      publicKey: string;
      signature: string;
      signedAt: number;
      nonce: string;
    };
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
  openclaw_sessions_list: {
    args: {
      search?: string;
      limit?: number;
      includeGlobal?: boolean;
      includeUnknown?: boolean;
    };
    return: unknown;
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
  git_read_file_at_ref: {
    args: { repoPath: string; gitRef: string; filePath: string };
    return: string;
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
  // Phase 3 migration commands
  get_migration_status: { args: Record<string, never>; return: MigrationStatusResponse };
  run_migration: {
    args: { projectId: string; projectPath: string; projectTitle: string };
    return: MigrationResultEntry;
  };
  run_all_migrations: { args: Record<string, never>; return: MigrationResultEntry[] };
  run_onboarding_reconciliation: {
    args: Record<string, never>;
    return: OnboardingReconciliationReport;
  };
  rename_project_md: { args: { projectPath: string }; return: boolean };
  get_project_migration_step: {
    args: { projectId: string; projectPath: string };
    return: string;
  };
  // Phase 6 sync commands
  install_openclaw_extension: { args: { openclawPath: string }; return: void };
  get_extension_content: { args: Record<string, never>; return: string };
  sync_local_launch: { args: Record<string, never>; return: SyncResult };
  sync_merge_remote: { args: { remoteDbJson: string }; return: [string, SyncResult] };
  sync_local_close: { args: Record<string, never>; return: SyncResult };
  get_db_json_for_sync: { args: Record<string, never>; return: string };
  ensure_sync_identity: { args: Record<string, never>; return: void };
  write_openclaw_system_context: {
    args: { clientUuid: string; hostname: string; platform: string };
    return: void;
  };
  get_openclaw_bearer_token: { args: Record<string, never>; return: string };
  set_openclaw_bearer_token: { args: { token: string }; return: void };
  clear_openclaw_bearer_token: { args: Record<string, never>; return: void };
  // Phase 2/5 data commands
  get_all_projects: { args: Record<string, never>; return: ProjectSummary[] };
  get_project: { args: { projectId: string }; return: ProjectWithContent };
  create_project_with_state: {
    args: {
      projectId: string;
      projectPath: string;
      title: string;
      status: string;
      description: string;
    };
    return: void;
  };
  update_roadmap_item: {
    args: {
      projectId: string;
      itemId: string;
      changes: RoadmapItemChanges;
    };
    return: void;
  };
  reorder_item: {
    args: {
      projectId: string;
      itemId: string;
      newPriority: number;
      newStatus?: string | null;
    };
    return: void;
  };
  batch_reorder_items: {
    args: {
      projectId: string;
      items: BatchReorderItemChange[];
    };
    return: void;
  };
  inject_agent_guidance: {
    args: { projectPath: string };
    return: BranchInjectionResult[];
  };
  // Phase 7 debug + validation commands
  export_debug_info: { args: Record<string, never>; return: string };
  get_validation_history: {
    args: Record<string, never>;
    return: Record<string, ValidationRejection[]>;
  };
  mark_rejection_resolved: {
    args: { projectId: string; timestamp: number };
    return: boolean;
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

export async function getOpenClawWsDeviceAuth(params: {
  nonce: string;
  clientId: string;
  clientMode: string;
  role: string;
  scopes: string[];
  token?: string;
}): Promise<{
  id: string;
  publicKey: string;
  signature: string;
  signedAt: number;
  nonce: string;
}> {
  return typedInvoke('get_openclaw_ws_device_auth', {
    nonce: params.nonce,
    clientId: params.clientId,
    clientMode: params.clientMode,
    role: params.role,
    scopes: params.scopes,
    token: params.token ?? null,
  });
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

export async function getOpenClawSessionsList(args?: {
  search?: string;
  limit?: number;
  includeGlobal?: boolean;
  includeUnknown?: boolean;
}): Promise<unknown> {
  return typedInvoke('openclaw_sessions_list', args ?? {});
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

export async function gitReadFileAtRef(
  repoPath: string,
  gitRef: string,
  filePath: string,
): Promise<string> {
  return typedInvoke('git_read_file_at_ref', { repoPath, gitRef, filePath });
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

// =============================================================================
// Phase 3 Migration
// =============================================================================

export interface MigrationStatusEntry {
  projectId: string;
  projectPath: string;
  step: string;
  usesLegacyFilename: boolean;
}

export interface MigrationStatusResponse {
  discoveryScope: string;
  trackedProjectCount: number;
  nonDbCandidateCount: number;
  statuses: MigrationStatusEntry[];
}

export interface MigrationResultEntry {
  projectPath: string;
  stepBefore: string;
  stepAfter: string;
  itemsImported: number;
  warnings: string[];
  error: string | null;
}

export interface OnboardingReconciliationInvariants {
  hasClawchestraMd: boolean;
  hasStateJson: boolean;
  gitignoreHasClawchestra: boolean;
  migrationStepComplete: boolean;
  noLegacyProjectMd: boolean;
  pass: boolean;
}

export interface OnboardingReconciliationProjectResult {
  projectId: string;
  projectPath: string;
  stepBefore: string;
  stepAfter: string;
  actions: string[];
  warnings: string[];
  invariants: OnboardingReconciliationInvariants;
}

export interface OnboardingReconciliationReport {
  generatedAt: string;
  totalProjects: number;
  repairedProjects: number;
  flaggedProjects: number;
  results: OnboardingReconciliationProjectResult[];
}

export async function getMigrationStatus(): Promise<MigrationStatusResponse> {
  return typedInvoke('get_migration_status');
}

export async function runMigration(
  projectId: string,
  projectPath: string,
  projectTitle: string,
): Promise<MigrationResultEntry> {
  return typedInvoke('run_migration', { projectId, projectPath, projectTitle });
}

export async function runAllMigrations(): Promise<MigrationResultEntry[]> {
  return typedInvoke('run_all_migrations');
}

export async function runOnboardingReconciliation(): Promise<OnboardingReconciliationReport> {
  return typedInvoke('run_onboarding_reconciliation');
}

export async function renameProjectMd(projectPath: string): Promise<boolean> {
  return typedInvoke('rename_project_md', { projectPath });
}

export async function getProjectMigrationStep(
  projectId: string,
  projectPath: string,
): Promise<string> {
  return typedInvoke('get_project_migration_step', { projectId, projectPath });
}

// =============================================================================
// Phase 6: OpenClaw Sync
// =============================================================================

export async function installOpenclawExtension(openclawPath: string): Promise<void> {
  return typedInvoke('install_openclaw_extension', { openclawPath });
}

export async function getExtensionContent(): Promise<string> {
  return typedInvoke('get_extension_content');
}

export async function syncLocalLaunch(): Promise<SyncResult> {
  return typedInvoke('sync_local_launch');
}

export async function syncMergeRemote(remoteDbJson: string): Promise<[string, SyncResult]> {
  return typedInvoke('sync_merge_remote', { remoteDbJson });
}

export async function syncLocalClose(): Promise<SyncResult> {
  return typedInvoke('sync_local_close');
}

export async function getDbJsonForSync(): Promise<string> {
  return typedInvoke('get_db_json_for_sync');
}

export async function ensureSyncIdentity(): Promise<void> {
  return typedInvoke('ensure_sync_identity');
}

export async function writeOpenclawSystemContext(
  clientUuid: string,
  hostname: string,
  platform: string,
): Promise<void> {
  return typedInvoke('write_openclaw_system_context', { clientUuid, hostname, platform });
}

export async function getOpenclawBearerToken(): Promise<string> {
  return typedInvoke('get_openclaw_bearer_token');
}

export async function setOpenclawBearerToken(token: string): Promise<void> {
  return typedInvoke('set_openclaw_bearer_token', { token });
}

export async function clearOpenclawBearerToken(): Promise<void> {
  return typedInvoke('clear_openclaw_bearer_token');
}

// Phase 2/5 data commands

export async function getAllProjects(): Promise<ProjectSummary[]> {
  return typedInvoke('get_all_projects');
}

export async function getProject(projectId: string): Promise<ProjectWithContent> {
  return typedInvoke('get_project', { projectId });
}

export async function createProjectWithState(
  projectId: string,
  projectPath: string,
  title: string,
  status: string,
  description: string,
): Promise<void> {
  return typedInvoke('create_project_with_state', {
    projectId,
    projectPath,
    title,
    status,
    description,
  });
}

export async function updateRoadmapItem(
  projectId: string,
  itemId: string,
  changes: RoadmapItemChanges,
): Promise<void> {
  return typedInvoke('update_roadmap_item', { projectId, itemId, changes });
}

export async function reorderItem(
  projectId: string,
  itemId: string,
  newPriority: number,
  newStatus?: string | null,
): Promise<void> {
  return typedInvoke('reorder_item', { projectId, itemId, newPriority, newStatus });
}

export async function batchReorderItems(
  projectId: string,
  items: BatchReorderItemChange[],
): Promise<void> {
  return typedInvoke('batch_reorder_items', { projectId, items });
}

export interface BranchInjectionResult {
  name: string;
  success: boolean;
  skipReason?: string;
}

export async function injectAgentGuidance(
  projectPath: string,
): Promise<BranchInjectionResult[]> {
  return typedInvoke('inject_agent_guidance', { projectPath });
}

// =============================================================================
// Phase 7: Debug Export & Validation
// =============================================================================

export interface ValidationRejection {
  timestamp: number;
  project_id: string;
  rejected_fields: string[];
  reason: string;
  resolved: boolean;
}

export async function exportDebugInfo(): Promise<string> {
  return typedInvoke('export_debug_info');
}

export async function getValidationHistory(): Promise<Record<string, ValidationRejection[]>> {
  return typedInvoke('get_validation_history');
}

export async function markRejectionResolved(
  projectId: string,
  timestamp: number,
): Promise<boolean> {
  return typedInvoke('mark_rejection_resolved', { projectId, timestamp });
}
