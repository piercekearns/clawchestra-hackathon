import { afterEach, describe, expect, it, mock } from 'bun:test';

function installTauriMocks(options: { tauriRuntime: boolean; onFlush?: () => void }) {
  mock.module('./tauri', () => ({
    chatFlush: async () => {
      options.onFlush?.();
    },
    isTauriRuntime: () => options.tauriRuntime,
  }));
}

async function importPersistenceFresh() {
  return import(`./chat-persistence.ts?case=${Math.random()}`);
}

afterEach(() => {
  mock.restore();
});

describe('chat persistence flush', () => {
  it('waits for pending tracked writes before flushing', async () => {
    let flushCalls = 0;
    installTauriMocks({
      tauriRuntime: true,
      onFlush: () => {
        flushCalls += 1;
      },
    });
    const persistence = await importPersistenceFresh();

    let resolveWrite: () => void = () => {
      throw new Error('pending write resolver was not initialized');
    };
    const pendingWrite = new Promise<void>((resolve) => {
      resolveWrite = resolve;
    });
    persistence.__chatPersistenceTestUtils.registerPendingWriteForTests(pendingWrite);

    let flushSettled = false;
    const flushPromise = persistence.flushChatPersistenceWrites().then(() => {
      flushSettled = true;
    });

    await Promise.resolve();
    expect(flushSettled).toBe(false);

    resolveWrite();
    await flushPromise;

    expect(flushCalls).toBe(1);
    expect(persistence.__chatPersistenceTestUtils.pendingWriteCountForTests()).toBe(0);
  });

  it('does not call chatFlush when not in tauri runtime', async () => {
    let flushCalls = 0;
    installTauriMocks({
      tauriRuntime: false,
      onFlush: () => {
        flushCalls += 1;
      },
    });
    const persistence = await importPersistenceFresh();

    await persistence.flushChatPersistenceWrites();
    expect(flushCalls).toBe(0);
  });
});
