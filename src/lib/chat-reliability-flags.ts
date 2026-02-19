export const CHAT_RELIABILITY_FLAGS = {
  chat: {
    update_flush_guard: true,
    activity_strict_sources: true,
    recovery_cursoring: true,
    compaction_semantic_states: true,
  },
} as const;

export type ChatReliabilityFlagKey = keyof typeof CHAT_RELIABILITY_FLAGS.chat;
