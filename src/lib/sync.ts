/**
 * sync.ts -- Frontend sync orchestration for Clawchestra.
 *
 * Phase 6.6 of the Architecture Direction plan.
 *
 * Coordinates sync triggers:
 * - On launch: read local -> read remote -> HLC merge -> write both
 * - On close: flush to remote with 3s timeout
 *
 * Local mode sync is handled entirely in Rust (sync.rs).
 * Remote mode HTTP calls are made here (frontend has `fetch` built in),
 * with merge logic delegated to Rust via Tauri commands.
 */

import type { SyncResult } from './tauri';
import type { SyncMode } from './settings';
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
