import { describe, expect, it } from 'bun:test';
import { __storeTestUtils } from './store';
import type { ChatMessage } from './gateway';

function compactionMessage(
  timestamp: number,
  title: string,
  options?: { runId?: string; loading?: boolean },
): ChatMessage {
  return {
    role: 'system',
    content: '',
    timestamp,
    systemMeta: {
      kind: 'compaction',
      title,
      ...(options?.runId ? { runId: options.runId } : {}),
      ...(typeof options?.loading === 'boolean' ? { loading: options.loading } : {}),
    },
  };
}

describe('store chat duplicate collapse', () => {
  it('replaces compaction bubble when runId matches', () => {
    const collapsed = __storeTestUtils.collapseChatDuplicates([
      compactionMessage(1000, 'Compacting conversation...', { runId: 'run-1', loading: true }),
      { role: 'assistant', content: 'working...', timestamp: 1010 },
      compactionMessage(1020, 'Conversation compacted', { runId: 'run-1', loading: false }),
    ]);

    expect(collapsed).toHaveLength(2);
    expect(collapsed[0]?.systemMeta?.kind).toBe('compaction');
    expect(collapsed[0]?.systemMeta?.title).toBe('Conversation compacted');
    expect(collapsed[0]?.systemMeta?.loading).toBe(false);
  });

  it('keeps distinct compaction bubbles for different runIds', () => {
    const collapsed = __storeTestUtils.collapseChatDuplicates([
      compactionMessage(1000, 'Compacting conversation...', { runId: 'run-1', loading: true }),
      compactionMessage(1020, 'Conversation compacted', { runId: 'run-2', loading: false }),
    ]);

    expect(collapsed).toHaveLength(2);
    expect(collapsed[0]?.systemMeta?.runId).toBe('run-1');
    expect(collapsed[1]?.systemMeta?.runId).toBe('run-2');
  });

  it('replaces nearby compaction bubbles when runId is missing', () => {
    const collapsed = __storeTestUtils.collapseChatDuplicates([
      compactionMessage(1000, 'Compacting conversation...', { loading: true }),
      compactionMessage(1000 + 10_000, 'Conversation compacted', { loading: false }),
    ]);

    expect(collapsed).toHaveLength(1);
    expect(collapsed[0]?.systemMeta?.title).toBe('Conversation compacted');
    expect(collapsed[0]?.systemMeta?.loading).toBe(false);
  });
});
