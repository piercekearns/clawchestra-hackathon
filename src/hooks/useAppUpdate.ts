import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { isTauriRuntime, checkForUpdate, runAppUpdate } from '../lib/tauri';

export function useAppUpdate() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [updating, setUpdating] = useState(false);
  const updateTriggeredRef = useRef(false);

  useEffect(() => {
    if (!isTauriRuntime()) return;

    const check = async () => {
      try {
        const status = await checkForUpdate();
        setUpdateAvailable(status.update_available);
      } catch {
        // Silently fail - don't show button if we can't check
      }
    };

    check();
    const interval = setInterval(check, 30_000);
    return () => clearInterval(interval);
  }, []);

  const handleUpdate = async () => {
    if (!isTauriRuntime() || updating || updateTriggeredRef.current) return;
    updateTriggeredRef.current = true;
    flushSync(() => {
      setUpdating(true);
    });
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
    try {
      await runAppUpdate();
    } catch (error) {
      console.error('Failed to start update:', error);
      updateTriggeredRef.current = false;
      setUpdating(false);
    }
  };

  return { updateAvailable, updating, handleUpdate };
}
