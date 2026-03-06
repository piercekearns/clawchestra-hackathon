import { chatFlush, isTauriRuntime } from './tauri';

const pendingPersistenceWrites = new Set<Promise<unknown>>();

export function trackChatPersistenceWrite<T>(write: Promise<T>): Promise<T> {
  pendingPersistenceWrites.add(write);
  return write.finally(() => {
    pendingPersistenceWrites.delete(write);
  });
}

export async function flushChatPersistenceWrites(): Promise<void> {
  if (pendingPersistenceWrites.size > 0) {
    await Promise.allSettled([...pendingPersistenceWrites]);
  }
  if (!isTauriRuntime()) return;
  try {
    await chatFlush();
  } catch (error) {
    console.warn('[ChatPersistence] chatFlush failed:', error);
  }
}

export const __chatPersistenceTestUtils = {
  registerPendingWriteForTests: <T>(write: Promise<T>) => trackChatPersistenceWrite(write),
  pendingWriteCountForTests: () => pendingPersistenceWrites.size,
  clearPendingWritesForTests: () => {
    pendingPersistenceWrites.clear();
  },
};
