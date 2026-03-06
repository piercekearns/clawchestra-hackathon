import { describe, expect, it } from 'bun:test';
import {
  normalizeChatContentWithContextUnwrap,
  stripAssistantControlDirectives,
  stripOpenClawEnvelope,
  unwrapGatewayContextWrappedUserContent,
} from './chat-normalization';

describe('chat normalization helpers', () => {
  it('unwraps context wrapper that uses explicit user request marker', () => {
    const wrapped =
      'User workspace path: /home/tester/openclaw-workspace\n\nUser request:\nPlease run /build for this plan.';
    expect(unwrapGatewayContextWrappedUserContent(wrapped)).toBe(
      'Please run /build for this plan.',
    );
  });

  it('unwraps flattened marker wrapper for project context', () => {
    const wrapped =
      'User is viewing project: Clawchestra User request: please run /plan_review';
    expect(unwrapGatewayContextWrappedUserContent(wrapped)).toBe(
      'please run /plan_review',
    );
  });

  it('unwraps canonical context wrapper with blank line', () => {
    const wrapped =
      'User workspace path: /home/tester/openclaw-workspace\n\nPlease run /build for this plan.';
    expect(unwrapGatewayContextWrappedUserContent(wrapped)).toBe(
      'Please run /build for this plan.',
    );
  });

  it('unwraps flattened single-line workspace wrapper', () => {
    const wrapped =
      'User workspace path: /home/tester/openclaw-workspace Please run /build for this plan.';
    expect(unwrapGatewayContextWrappedUserContent(wrapped)).toBe(
      'Please run /build for this plan.',
    );
  });

  it('normalizes content using unwrapped text when available', () => {
    const wrapped =
      'User workspace path: /home/tester/openclaw-workspace\n\nPlease run /build for this plan.';
    expect(normalizeChatContentWithContextUnwrap(wrapped)).toBe(
      'Please run /build for this plan.',
    );
  });

  it('unwraps full OpenClaw 2026.2.17 envelope with conversation info + timestamp', () => {
    const wrapped = [
      'Conversation info (untrusted metadata):',
      '```json',
      '{',
      '  "message_id": "abc-123",',
      '  "sender": "openclaw-control-ui"',
      '}',
      '```',
      '',
      '[Mon 2026-03-03 05:15 GMT] User workspace path: /home/tester/openclaw-workspace User request: What version are we on?',
      '[message_id: abc-123]',
    ].join('\n');
    expect(unwrapGatewayContextWrappedUserContent(wrapped)).toBe(
      'What version are we on?',
    );
  });

  it('unwraps envelope with conversation info but no timestamp', () => {
    const wrapped = [
      'Conversation info (untrusted metadata):',
      '```json',
      '{',
      '  "message_id": "abc-123",',
      '  "sender": "openclaw-control-ui"',
      '}',
      '```',
      '',
      'User workspace path: /home/tester/openclaw-workspace User request: run tests',
    ].join('\n');
    expect(unwrapGatewayContextWrappedUserContent(wrapped)).toBe('run tests');
  });
});

describe('stripOpenClawEnvelope', () => {
  it('strips full envelope with conversation info + timestamp + wrapper', () => {
    const raw = [
      'Conversation info (untrusted metadata):',
      '```json',
      '{',
      '  "message_id": "abc-123",',
      '  "sender": "openclaw-control-ui"',
      '}',
      '```',
      '',
      '[Mon 2026-03-03 05:15 GMT] User workspace path: /home/tester/openclaw-workspace User request: What version are we on?',
      '[message_id: abc-123]',
    ].join('\n');
    expect(stripOpenClawEnvelope(raw)).toBe('What version are we on?');
  });

  it('strips conversation info block alone', () => {
    const raw = [
      'Conversation info (untrusted metadata):',
      '```json',
      '{',
      '  "message_id": "abc-123",',
      '  "sender": "openclaw-control-ui"',
      '}',
      '```',
      '',
      'Hello world',
    ].join('\n');
    expect(stripOpenClawEnvelope(raw)).toBe('Hello world');
  });

  it('strips timestamp + workspace wrapper without conversation info', () => {
    const raw =
      '[Mon 2026-03-03 05:15 GMT] User workspace path: /home/tester/openclaw-workspace User request: run tests';
    expect(stripOpenClawEnvelope(raw)).toBe('run tests');
  });

  it('strips trailing message_id tag', () => {
    const raw = 'Hello there\n[message_id: b151174c-c90e-4b18-9d2c-5c5ae550f8b7]';
    expect(stripOpenClawEnvelope(raw)).toBe('Hello there');
  });

  it('reformats trailing attached images tag as readable line', () => {
    const raw = 'Check this out\n[Attached images: screenshot.jpg]';
    expect(stripOpenClawEnvelope(raw)).toBe('Check this out\n\n📎 screenshot.jpg');
  });

  it('returns plain messages unchanged', () => {
    expect(stripOpenClawEnvelope('Hello world')).toBe('Hello world');
    expect(stripOpenClawEnvelope('run the tests please')).toBe('run the tests please');
  });

  it('handles empty/whitespace input', () => {
    expect(stripOpenClawEnvelope('')).toBe('');
    expect(stripOpenClawEnvelope('  ')).toBe('');
  });
});

describe('stripAssistantControlDirectives', () => {
  it('strips a leaked reply_to_current directive prefix', () => {
    const raw = '[[reply_to_current]]\nHere is the actual assistant reply.';
    expect(stripAssistantControlDirectives(raw)).toBe(
      'Here is the actual assistant reply.',
    );
  });

  it('strips repeated directive prefixes and preserves body', () => {
    const raw =
      '[[reply_to_current]]\n[[reply_to_current]]\n\nFinal response body.';
    expect(stripAssistantControlDirectives(raw)).toBe('Final response body.');
  });

  it('leaves bracketed text untouched when not a leading control directive', () => {
    const raw = 'Documenting syntax: [[reply_to_current]] is an internal token.';
    expect(stripAssistantControlDirectives(raw)).toBe(raw);
  });
});
