import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { saveWindowState, StateFlags } from '@tauri-apps/plugin-window-state';
import { getActiveTurnCount, subscribeTurnRegistry } from '../lib/gateway';
import { CHAT_RELIABILITY_FLAGS } from '../lib/chat-reliability-flags';
import { flushChatPersistenceWrites } from '../lib/chat-persistence';
import {
  isTauriRuntime,
  checkForUpdate,
  getAppUpdateLockState,
  readFile,
  runAppUpdate,
} from '../lib/tauri';

const UPDATE_MONITOR_INTERVAL_MS = 2000;
const UPDATE_LOCK_APPEAR_GRACE_MS = 15_000;
const UPDATE_STUCK_TIMEOUT_MS = 20 * 60_000;

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Unknown update error';
}

function extractUpdateLogPath(updateStartMessage: string): string | null {
  const match = /log:\s*(\/tmp\/clawchestra-update-\d+\.log)/.exec(updateStartMessage);
  return match?.[1] ?? null;
}

function summarizeUpdateFailureLog(content: string): string | null {
  const lines = content.split(/\r?\n/);

  const tsLine = lines.find((line) => line.includes('error TS'));
  if (tsLine) return `Build failed: ${tsLine.trim()}`;

  const rustCodeLine = lines.find((line) => /^\s*error\[E\d+\]/.test(line));
  if (rustCodeLine) return `Build failed: ${rustCodeLine.trim()}`;

  const rustCompileLine = lines.find((line) => line.includes('could not compile'));
  if (rustCompileLine) return `Build failed: ${rustCompileLine.trim()}`;

  const beforeBuildFailure = lines.find(
    (line) => line.includes('beforeBuildCommand') && line.includes('failed'),
  );
  if (beforeBuildFailure) return `Build failed: ${beforeBuildFailure.trim()}`;

  const lifecycleFailure = lines.find(
    (line) => line.includes('ELIFECYCLE') || line.includes('failed with exit code'),
  );
  if (lifecycleFailure) return `Build failed: ${lifecycleFailure.trim()}`;

  const explicitFailure = lines.find((line) => line.includes('❌'));
  if (explicitFailure) return `Update failed: ${explicitFailure.trim()}`;

  const success =
    content.includes('✅ Update applied and app restarted') ||
    content.includes('✅ Build complete (restart disabled)');
  if (success) return null;

  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i]?.trim();
    if (line) return `Update failed: ${line}`;
  }

  return 'Update failed before restart';
}

export function getUpdateBlockedReason(
  activeTurnCount: number,
  enforceFlushGuard: boolean,
): string | null {
  if (enforceFlushGuard && activeTurnCount > 0) {
    return `Active chat turn detected (${activeTurnCount}) — update will force restart and may interrupt current response.`;
  }
  return null;
}

export function useAppUpdate() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [updateBlockedReason, setUpdateBlockedReason] = useState<string | null>(null);
  const [updateFailureReason, setUpdateFailureReason] = useState<string | null>(null);
  const updateTriggeredRef = useRef(false);
  const monitorTimerRef = useRef<number | null>(null);
  const monitorStartedAtRef = useRef(0);
  const updateRequestedAtRef = useRef(0);
  const updateLogPathRef = useRef<string | null>(null);
  const sawUpdateLockRef = useRef(false);
  const mountedRef = useRef(true);

  const clearUpdateMonitor = () => {
    if (monitorTimerRef.current !== null) {
      window.clearInterval(monitorTimerRef.current);
      monitorTimerRef.current = null;
    }
  };

  const resetUpdatingState = async () => {
    if (!mountedRef.current) return;
    updateTriggeredRef.current = false;
    setUpdating(false);
    try {
      const status = await checkForUpdate();
      if (mountedRef.current) {
        setUpdateAvailable(status.update_available);
        if (!status.update_available) {
          setUpdateFailureReason(null);
        }
      }
    } catch {
      // Ignore refresh failure and keep current button state.
    }
  };

  const startUpdateMonitor = (requestedAtMs: number) => {
    clearUpdateMonitor();
    monitorStartedAtRef.current = Date.now();
    updateRequestedAtRef.current = requestedAtMs;
    sawUpdateLockRef.current = false;

    monitorTimerRef.current = window.setInterval(async () => {
      if (!mountedRef.current) return;

      let lockPresent = false;
      let lockStale = false;
      try {
        const lockState = await getAppUpdateLockState();
        lockPresent = lockState.lockPresent;
        lockStale = lockState.stale;
      } catch {
        lockPresent = false;
        lockStale = false;
      }

      if (lockPresent && !lockStale) {
        sawUpdateLockRef.current = true;
        return;
      }

      const elapsed = Date.now() - monitorStartedAtRef.current;

      // If we never saw a lock shortly after clicking update, the update
      // script likely failed to start.
      if (!lockStale && !sawUpdateLockRef.current && elapsed < UPDATE_LOCK_APPEAR_GRACE_MS) {
        return;
      }

      let failureReason: string | null = null;
      const logPath = updateLogPathRef.current;
      if (logPath) {
        try {
          const logContent = await readFile(logPath);
          const summary = summarizeUpdateFailureLog(logContent);
          if (summary) {
            failureReason = `${summary} (${logPath})`;
          }
        } catch {
          failureReason = `Update failed. See log: ${logPath}`;
        }
      }

      clearUpdateMonitor();
      await resetUpdatingState();
      if (mountedRef.current) {
        setUpdateFailureReason(failureReason);
      }
    }, UPDATE_MONITOR_INTERVAL_MS);
  };

  useEffect(() => {
    mountedRef.current = true;
    if (!isTauriRuntime()) return;

    const check = async () => {
      try {
        const status = await checkForUpdate();
        if (mountedRef.current) {
          setUpdateAvailable(status.update_available);
        }
      } catch {
        // Silently fail - don't show button if we can't check
      }
    };

    check();
    const interval = setInterval(check, 30_000);
    return () => {
      mountedRef.current = false;
      clearInterval(interval);
      clearUpdateMonitor();
    };
  }, []);

  const handleUpdate = async () => {
    if (!isTauriRuntime() || updating || updateTriggeredRef.current) return;
    const updateRequestedAt = Date.now();
    updateRequestedAtRef.current = updateRequestedAt;
    updateLogPathRef.current = null;
    const activeTurnCount = getActiveTurnCount();
    const enforceFlushGuard = CHAT_RELIABILITY_FLAGS.chat.update_flush_guard;
    const blockedReason = getUpdateBlockedReason(activeTurnCount, enforceFlushGuard);
    const forcingActiveTurnUpdate = Boolean(blockedReason);
    if (forcingActiveTurnUpdate) {
      console.warn('[Update]', {
        updateRequestedAt,
        reason: 'update_force_active_turns',
        activeTurnCount,
      });
      setUpdateBlockedReason(blockedReason);
    } else {
      setUpdateBlockedReason(null);
    }
    setUpdateFailureReason(null);
    updateTriggeredRef.current = true;
    flushSync(() => {
      setUpdating(true);
    });
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
    try {
      const flushStartAt = Date.now();
      await flushChatPersistenceWrites();
      const flushEndAt = Date.now();
      console.log('[Update]', {
        updateRequestedAt,
        flushStartAt,
        flushEndAt,
        activeTurnCount,
      });
      // Save window geometry so the restart opens at the same size/position.
      await saveWindowState(StateFlags.ALL).catch(() => {});
      const updateStartMessage = await runAppUpdate({
        activeTurnCount,
        enforceFlushGuard,
        allowForce: forcingActiveTurnUpdate,
      });
      updateLogPathRef.current = extractUpdateLogPath(updateStartMessage);
      console.log('[Update]', {
        updateRequestedAt,
        flushStartAt,
        flushEndAt,
        restartIssuedAt: Date.now(),
        updateLogPath: updateLogPathRef.current,
      });
      startUpdateMonitor(updateRequestedAt);
    } catch (error) {
      console.error('Failed to start update:', error);
      clearUpdateMonitor();
      updateLogPathRef.current = null;
      if (mountedRef.current) {
        setUpdateFailureReason(`Update failed: ${extractErrorMessage(error)}`);
      }
      await resetUpdatingState();
    }

    // Hard safety timeout: never leave "Updating" stuck forever.
    window.setTimeout(() => {
      if (!mountedRef.current || !updateTriggeredRef.current) return;
      if (Date.now() - monitorStartedAtRef.current < UPDATE_STUCK_TIMEOUT_MS) return;
      clearUpdateMonitor();
      void resetUpdatingState();
    }, UPDATE_STUCK_TIMEOUT_MS + 1000);
  };

  useEffect(() => {
    if (!updating) return;

    // If app is still alive and no monitor is running (e.g. hook remount),
    // resume monitoring so we can recover from stale updating UI state.
    if (monitorTimerRef.current === null) {
      const requestedAt = updateRequestedAtRef.current || Date.now();
      startUpdateMonitor(requestedAt);
    }
  }, [updating]);

  useEffect(() => {
    if (!updateBlockedReason) return;
    const unsubscribe = subscribeTurnRegistry((turns) => {
      const hasActiveTurns = turns.some(
        (turn) =>
          turn.status === 'queued' ||
          turn.status === 'running' ||
          turn.status === 'awaiting_output',
      );
      if (!hasActiveTurns) {
        setUpdateBlockedReason(null);
      }
    });
    return () => {
      unsubscribe();
    };
  }, [updateBlockedReason]);

  return { updateAvailable, updating, updateBlockedReason, updateFailureReason, handleUpdate };
}
