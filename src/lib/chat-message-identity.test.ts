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

  it('deduplicates local clean message against gateway-recovered wrapped version', () => {
    const local = {
      role: 'user' as const,
      content: 'check the sync dialog\n\n[Attached images: screenshot.jpg]',
      timestamp: 1000,
    };
    const recovered = {
      role: 'user' as const,
      content: 'check the sync dialog',
      timestamp: 1001,
    };

    // Signatures should match — [Attached images:] is metadata, not user content
    expect(messageIdentitySignature(local)).toBe(messageIdentitySignature(recovered));
    expect(isLikelyDuplicateMessage(local, recovered, 5_000)).toBe(true);
  });

  it('deduplicates clean message against full OpenClaw envelope', () => {
    const clean = {
      role: 'user' as const,
      content: 'run tests',
      timestamp: 1000,
    };
    const wrapped = {
      role: 'user' as const,
      content: [
        'Conversation info (untrusted metadata):',
        '```json',
        '{ "message_id": "abc", "sender": "openclaw-control-ui" }',
        '```',
        '',
        '[Thu 2026-02-19 05:28 GMT] User workspace path: /path User request: run tests',
        '[message_id: abc]',
      ].join('\n'),
      timestamp: 1001,
    };

    expect(messageIdentitySignature(clean)).toBe(messageIdentitySignature(wrapped));
    expect(isLikelyDuplicateMessage(clean, wrapped, 5_000)).toBe(true);
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
