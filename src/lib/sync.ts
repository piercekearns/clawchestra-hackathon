/**
 * sync.ts -- Frontend sync orchestration and status display for Clawchestra.
 *
 * Phase 6.6 of the Architecture Direction plan.
 *
 * Sync triggers (on-launch, continuous, on-close) are owned by Rust (sync.rs).
 * This module provides:
 * - Remote mode HTTP sync for launch/close (frontend has `fetch` built in)
 * - SyncStatus type for UI display
 * - formatLastSyncTime() helper for human-readable timestamps
 * - getSyncStatusForDisplay() selector consumed by Header + Settings Dialog
 */

import type { SyncResult } from './tauri';
import type { SyncMode } from './settings';

// ---------------------------------------------------------------------------
// Sync status types and helpers (consumed by Header + Settings Dialog)
// ---------------------------------------------------------------------------

/** Sync state for the UI indicator. */
export type SyncStatus = 'synced' | 'syncing' | 'error' | 'disabled';

/** Display model for the sync status indicator. */
export interface SyncStatusDisplay {
  status: SyncStatus;
  label: string;
  lastSyncTime: string | null;
}

/**
 * Format a wall-clock timestamp (milliseconds since epoch) as a human-readable
 * relative time string (e.g., "just now", "2 minutes ago", "1 hour ago").
 */
export function formatLastSyncTime(timestampMs: number | null | undefined): string | null {
  if (!timestampMs) return null;
  const now = Date.now();
  const diffMs = now - timestampMs;

  if (diffMs < 0) return 'just now'; // clock skew tolerance
  if (diffMs < 60_000) return 'just now';
  if (diffMs < 3_600_000) {
    const mins = Math.floor(diffMs / 60_000);
    return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  }
  if (diffMs < 86_400_000) {
    const hours = Math.floor(diffMs / 3_600_000);
    return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  }
  const days = Math.floor(diffMs / 86_400_000);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

/**
 * Derive the sync status display model from current state.
 * Consumed by the Header sync indicator and Settings Dialog.
 */
export function getSyncStatusForDisplay(
  syncMode: SyncMode,
  lastSyncedAt: number | null | undefined,
  lastSyncError: string | null | undefined,
): SyncStatusDisplay {
  if (syncMode === 'Disabled' || syncMode === 'Unknown') {
    return { status: 'disabled', label: 'Sync disabled', lastSyncTime: null };
  }

  if (lastSyncError) {
    return {
      status: 'error',
      label: 'Sync failed — will retry on next change',
      lastSyncTime: formatLastSyncTime(lastSyncedAt),
    };
  }

  if (!lastSyncedAt) {
    return { status: 'synced', label: 'Not synced yet', lastSyncTime: null };
  }

  return {
    status: 'synced',
    label: 'Synced',
    lastSyncTime: formatLastSyncTime(lastSyncedAt),
  };
}
import {
  syncLocalLaunch,
  syncMergeRemote,
  syncLocalClose,
  getDbJsonForSync,
  isTauriRuntime,
} from './tauri';

/** Timeout for remote sync on close (milliseconds). */
const CLOSE_SYNC_TIMEOUT_MS = 3_000;

/** Timeout for remote sync on launch (milliseconds). */
const LAUNCH_SYNC_TIMEOUT_MS = 10_000;

/**
 * Perform the full sync-on-launch sequence.
 *
 * - Local mode: delegates entirely to Rust
 * - Remote mode: fetches remote DB via HTTP, sends to Rust for merge,
 *   then PUTs the merged result back
 * - Disabled: no-op
 */
export async function performSyncOnLaunch(
  syncMode: SyncMode,
  remoteUrl?: string | null,
  bearerToken?: string | null,
): Promise<SyncResult> {
  if (!isTauriRuntime()) {
    return {
      success: true,
      message: 'Not in Tauri runtime',
      warnings: [],
      fieldsFromRemote: 0,
      fieldsFromLocal: 0,
    };
  }

  if (syncMode === 'Disabled' || syncMode === 'Unknown') {
    return {
      success: true,
      message: 'Sync disabled',
      warnings: [],
      fieldsFromRemote: 0,
      fieldsFromLocal: 0,
    };
  }

  if (syncMode === 'Local') {
    return syncLocalLaunch();
  }

  // Remote mode
  if (!remoteUrl) {
    return {
      success: false,
      message: 'Remote sync configured but no URL set',
      warnings: ['Configure openclawRemoteUrl in settings'],
      fieldsFromRemote: 0,
      fieldsFromLocal: 0,
    };
  }

  return performRemoteSyncOnLaunch(remoteUrl, bearerToken ?? undefined);
}

/**
 * Remote sync on launch:
 * 1. GET remote db.json
 * 2. Send to Rust for HLC merge
 * 3. PUT merged result back to remote
 */
async function performRemoteSyncOnLaunch(
  remoteUrl: string,
  bearerToken?: string,
): Promise<SyncResult> {
  const warnings: string[] = [];
  const baseUrl = remoteUrl.replace(/\/+$/, '');
  const getUrl = `${baseUrl}/clawchestra/data/db.json`;

  // 1. GET remote db.json
  let remoteDbJson: string | null = null;
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (bearerToken) {
      headers['Authorization'] = `Bearer ${bearerToken}`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), LAUNCH_SYNC_TIMEOUT_MS);

    const response = await fetch(getUrl, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (response.ok) {
      remoteDbJson = await response.text();
    } else if (response.status === 404) {
      // Remote has no data yet -- will push local after merge
      remoteDbJson = null;
    } else {
      warnings.push(
        `Remote sync data could not be read (HTTP ${response.status}). Using local data only.`,
      );
    }
  } catch (err) {
    warnings.push(
      `Remote sync data could not be read: ${err instanceof Error ? err.message : String(err)}. Using local data only.`,
    );
  }

  if (remoteDbJson === null) {
    // No remote data -- push local to remote
    try {
      const localDbJson = await getDbJsonForSync();
      await pushToRemote(baseUrl, localDbJson, bearerToken);
    } catch {
      warnings.push('Failed to push local DB to remote');
    }

    return {
      success: true,
      message: 'No remote data found. Pushed local DB to remote.',
      warnings,
      fieldsFromRemote: 0,
      fieldsFromLocal: 0,
    };
  }

  // 2. Merge via Rust
  const [mergedJson, result] = await syncMergeRemote(remoteDbJson);

  // 3. PUT merged back to remote
  try {
    await pushToRemote(baseUrl, mergedJson, bearerToken);
  } catch (err) {
    result.warnings.push(
      `Failed to push merged DB to remote: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Combine warnings
  result.warnings = [...warnings, ...result.warnings];

  return result;
}

/**
 * Perform the sync-on-close sequence.
 *
 * - Local mode: delegates to Rust
 * - Remote mode: PUTs current DB to remote with 3s timeout
 * - Disabled: no-op
 */
export async function performSyncOnClose(
  syncMode: SyncMode,
  remoteUrl?: string | null,
  bearerToken?: string | null,
): Promise<SyncResult> {
  if (!isTauriRuntime()) {
    return {
      success: true,
      message: 'Not in Tauri runtime',
      warnings: [],
      fieldsFromRemote: 0,
      fieldsFromLocal: 0,
    };
  }

  if (syncMode === 'Disabled' || syncMode === 'Unknown') {
    return {
      success: true,
      message: 'Sync disabled',
      warnings: [],
      fieldsFromRemote: 0,
      fieldsFromLocal: 0,
    };
  }

  if (syncMode === 'Local') {
    // Rust handles local sync on close via the window event handler.
    // This is a backup call from TypeScript.
    return syncLocalClose();
  }

  // Remote mode
  if (!remoteUrl) {
    return {
      success: false,
      message: 'Remote sync configured but no URL set',
      warnings: [],
      fieldsFromRemote: 0,
      fieldsFromLocal: 0,
    };
  }

  return performRemoteSyncOnClose(remoteUrl, bearerToken ?? undefined);
}

/**
 * Remote sync on close: PUT current DB to remote with 3s timeout.
 * Does NOT block app shutdown -- failure is logged.
 */
async function performRemoteSyncOnClose(
  remoteUrl: string,
  bearerToken?: string,
): Promise<SyncResult> {
  try {
    const dbJson = await getDbJsonForSync();
    const baseUrl = remoteUrl.replace(/\/+$/, '');
    await pushToRemote(baseUrl, dbJson, bearerToken, CLOSE_SYNC_TIMEOUT_MS);

    return {
      success: true,
      message: 'Remote sync on close: written',
      warnings: [],
      fieldsFromRemote: 0,
      fieldsFromLocal: 0,
    };
  } catch (err) {
    return {
      success: false,
      message: `Remote sync on close failed: ${err instanceof Error ? err.message : String(err)}`,
      warnings: [],
      fieldsFromRemote: 0,
      fieldsFromLocal: 0,
    };
  }
}

/**
 * PUT db.json to the remote OpenClaw endpoint.
 */
async function pushToRemote(
  baseUrl: string,
  dbJson: string,
  bearerToken?: string,
  timeoutMs: number = LAUNCH_SYNC_TIMEOUT_MS,
): Promise<void> {
  const putUrl = `${baseUrl}/clawchestra/data/db.json`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (bearerToken) {
    headers['Authorization'] = `Bearer ${bearerToken}`;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const response = await fetch(putUrl, {
    method: 'PUT',
    headers,
    body: dbJson,
    signal: controller.signal,
  });
  clearTimeout(timeout);

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
}
