/**
 * tauri-events.ts — Subscribe to typed Tauri events from the Rust backend.
 *
 * Phase 2.8: Sets up listeners for state-json-merged and clawchestra-ready
 * events emitted by the unified Rust file watcher (Phase 2.3).
 *
 * Phase 3: Adds migration-progress event for migration UI.
 *
 * Phase 5: Adds project-file-changed and git-status-changed events,
 * replacing the old TypeScript watcher (src/lib/watcher.ts).
 *
 * Call `setupTauriEventListeners()` once during app initialization.
 * Returns an unsubscribe function for cleanup.
 */

import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { StateJsonMergedPayload, ClawchestraReadyPayload } from './state-json';
import { isTauriRuntime } from './tauri';

/** Payload for 'migration-progress' event (emitted per project during run_all_migrations) */
export interface MigrationProgressPayload {
  projectId: string;
  completed: number;
  total: number;
  error: string | null;
}

/** Payload for 'migration-launch-summary' event (emitted once after startup sweep) */
export interface MigrationLaunchSummaryPayload {
  scannedProjectCount: number;
  migratedCount: number;
  legacyRenamedCount: number;
  warningCount: number;
  warnings: string[];
}

/** Payload for 'project-file-changed' event (CLAWCHESTRA.md or PROJECT.md modified) */
export interface ProjectFileChangedPayload {
  projectPath: string;
  fileName: string;
}

/** Payload for 'git-status-changed' event (git-tracked files modified) */
export interface GitStatusChangedPayload {
  projectPath: string;
}

function safeUnlisten(unlisten: UnlistenFn): void {
  try {
    const result = (unlisten as unknown as (() => Promise<void> | void))();
    void Promise.resolve(result).catch((error) => {
      console.warn('[TauriEvents] Listener cleanup failed:', error);
    });
  } catch (error) {
    console.warn('[TauriEvents] Listener cleanup failed:', error);
  }
}

/**
 * Set up listeners for all Tauri events emitted by the Rust backend.
 *
 * - `state-json-merged`: An external agent changed a project's state.json,
 *   and the Rust watcher has validated, merged, and projected the changes.
 *   Updates the Zustand store for the affected project.
 *
 * - `clawchestra-ready`: The Rust startup sequence has completed (settings
 *   loaded, db.json loaded, migrations run, watcher started). Safe to call
 *   `get_all_projects` after this event.
 *
 * - `migration-progress`: Per-project progress during batch migration.
 *
 * - `migration-launch-summary`: Startup migration sweep summary for legacy projects.
 *
 * - `project-file-changed`: CLAWCHESTRA.md or PROJECT.md was modified
 *   externally. Triggers a project reload.
 *
 * - `git-status-changed`: A git-tracked file was modified. Triggers a
 *   project reload to refresh git status indicators.
 *
 * Returns a cleanup function that removes all listeners.
 */
export async function setupTauriEventListeners(handlers: {
  onStateJsonMerged: (payload: StateJsonMergedPayload) => void;
  onClawchestraReady: (payload: ClawchestraReadyPayload) => void;
  onMigrationProgress?: (payload: MigrationProgressPayload) => void;
  onMigrationLaunchSummary?: (payload: MigrationLaunchSummaryPayload) => void;
  onProjectFileChanged?: (payload: ProjectFileChangedPayload) => void;
  onGitStatusChanged?: (payload: GitStatusChangedPayload) => void;
}): Promise<() => void> {
  if (!isTauriRuntime()) {
    // No-op in non-Tauri environments (web dev, tests)
    return () => {};
  }

  const unlisteners: UnlistenFn[] = [];

  const unlistenMerged = await listen<StateJsonMergedPayload>(
    'state-json-merged',
    (event) => {
      handlers.onStateJsonMerged(event.payload);
    },
  );
  unlisteners.push(unlistenMerged);

  const unlistenReady = await listen<ClawchestraReadyPayload>(
    'clawchestra-ready',
    (event) => {
      handlers.onClawchestraReady(event.payload);
    },
  );
  unlisteners.push(unlistenReady);

  if (handlers.onMigrationProgress) {
    const handler = handlers.onMigrationProgress;
    const unlistenMigration = await listen<MigrationProgressPayload>(
      'migration-progress',
      (event) => {
        handler(event.payload);
      },
    );
    unlisteners.push(unlistenMigration);
  }

  if (handlers.onMigrationLaunchSummary) {
    const handler = handlers.onMigrationLaunchSummary;
    const unlistenLaunchSummary = await listen<MigrationLaunchSummaryPayload>(
      'migration-launch-summary',
      (event) => {
        handler(event.payload);
      },
    );
    unlisteners.push(unlistenLaunchSummary);
  }

  if (handlers.onProjectFileChanged) {
    const handler = handlers.onProjectFileChanged;
    const unlistenProjectFile = await listen<ProjectFileChangedPayload>(
      'project-file-changed',
      (event) => {
        handler(event.payload);
      },
    );
    unlisteners.push(unlistenProjectFile);
  }

  if (handlers.onGitStatusChanged) {
    const handler = handlers.onGitStatusChanged;
    const unlistenGitStatus = await listen<GitStatusChangedPayload>(
      'git-status-changed',
      (event) => {
        handler(event.payload);
      },
    );
    unlisteners.push(unlistenGitStatus);
  }

  return () => {
    for (const unlisten of unlisteners) {
      safeUnlisten(unlisten);
    }
  };
}
