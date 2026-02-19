import { describe, expect, it } from 'bun:test';
import {
  isLikelyDuplicateMessage,
  messageIdentitySignature,
  normalizeMessageIdentityContent,
  unwrapUserContentForDisplay,
} from './chat-message-identity';

describe('chat message identity helpers', () => {
  it('unwraps context wrapped user content for identity', () => {
    const message = {
      role: 'user' as const,
      content: 'User workspace path: /Users/piercekearns/clawdbot-sandbox\n\nUser request:\nrun /build',
      timestamp: 100,
    };

    expect(unwrapUserContentForDisplay(message)).toBe('run /build');
    expect(normalizeMessageIdentityContent(message)).toBe('run /build');
  });

  it('uses role + normalized content as identity signature', () => {
    const signature = messageIdentitySignature({
      role: 'assistant',
      content: '  Build   ready.  ',
      timestamp: 10,
    });

    expect(signature).toBe('assistant:Build ready.');
  });

  it('requires exact match for user dedupe (no prefix collapse)', () => {
    const existing = { role: 'user' as const, content: 'run /build now', timestamp: 1000 };
    const incoming = { role: 'user' as const, content: 'run /build', timestamp: 1001 };

    expect(isLikelyDuplicateMessage(existing, incoming, 5_000)).toBe(false);
  });

  it('allows progressive overlap dedupe for assistant messages', () => {
    const existing = { role: 'assistant' as const, content: 'Working on phase 1', timestamp: 1000 };
    const incoming = {
      role: 'assistant' as const,
      content: 'Working on phase 1 and phase 2',
      timestamp: 1001,
    };

    expect(isLikelyDuplicateMessage(existing, incoming, 5_000)).toBe(true);
  });
});
