import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { getActiveTurnCount, subscribeTurnRegistry } from '../lib/gateway';
import { CHAT_RELIABILITY_FLAGS } from '../lib/chat-reliability-flags';
import { flushChatPersistenceWrites } from '../lib/chat-persistence';
import {
  isTauriRuntime,
  checkForUpdate,
  getAppUpdateLockState,
  runAppUpdate,
} from '../lib/tauri';

const UPDATE_MONITOR_INTERVAL_MS = 2000;
const UPDATE_LOCK_APPEAR_GRACE_MS = 15_000;
const UPDATE_STUCK_TIMEOUT_MS = 20 * 60_000;

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
  const updateTriggeredRef = useRef(false);
  const monitorTimerRef = useRef<number | null>(null);
  const monitorStartedAtRef = useRef(0);
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
      }
    } catch {
      // Ignore refresh failure and keep current button state.
    }
  };

  const startUpdateMonitor = () => {
    clearUpdateMonitor();
    monitorStartedAtRef.current = Date.now();
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

      clearUpdateMonitor();
      await resetUpdatingState();
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
      await runAppUpdate({
        activeTurnCount,
        enforceFlushGuard,
        allowForce: forcingActiveTurnUpdate,
      });
      console.log('[Update]', {
        updateRequestedAt,
        flushStartAt,
        flushEndAt,
        restartIssuedAt: Date.now(),
      });
      startUpdateMonitor();
    } catch (error) {
      console.error('Failed to start update:', error);
      clearUpdateMonitor();
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
      startUpdateMonitor();
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

  return { updateAvailable, updating, updateBlockedReason, handleUpdate };
}
