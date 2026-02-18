import { describe, expect, it } from 'bun:test';
import {
  normalizeChatContentWithContextUnwrap,
  unwrapGatewayContextWrappedUserContent,
} from './chat-normalization';

describe('chat normalization helpers', () => {
  it('unwraps context wrapper that uses explicit user request marker', () => {
    const wrapped =
      'User workspace path: /Users/piercekearns/clawdbot-sandbox\n\nUser request:\nPlease run /build for this plan.';
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
      'User workspace path: /Users/piercekearns/clawdbot-sandbox\n\nPlease run /build for this plan.';
    expect(unwrapGatewayContextWrappedUserContent(wrapped)).toBe(
      'Please run /build for this plan.',
    );
  });

  it('unwraps flattened single-line workspace wrapper', () => {
    const wrapped =
      'User workspace path: /Users/piercekearns/clawdbot-sandbox Please run /build for this plan.';
    expect(unwrapGatewayContextWrappedUserContent(wrapped)).toBe(
      'Please run /build for this plan.',
    );
  });

  it('normalizes content using unwrapped text when available', () => {
    const wrapped =
      'User workspace path: /Users/piercekearns/clawdbot-sandbox\n\nPlease run /build for this plan.';
    expect(normalizeChatContentWithContextUnwrap(wrapped)).toBe(
      'Please run /build for this plan.',
    );
  });
});
