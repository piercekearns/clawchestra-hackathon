import { describe, expect, it } from 'bun:test';
import {
  buildFailureBubbleDedupeKey,
  classifyUpstreamFailure,
  shouldParseAssistantContentForSessionDiscovery,
} from './lib/chat-reliability';

describe('chat reliability helpers', () => {
  it('classifies 429/rate-limit upstream failures with retry guidance', () => {
    expect(classifyUpstreamFailure('HTTP 429 Too Many Requests')).toEqual({
      type: 'rate_limit',
      title: 'Rate limit reached',
      action: 'Wait briefly, then retry',
    });
  });

  it('classifies aborted background monitoring runs with recovery guidance', () => {
    expect(classifyUpstreamFailure('Error: OpenClaw chat aborted')).toEqual({
      type: 'monitor_timeout',
      title: 'Background monitoring timed out',
      action: 'Check the tmux/background session; work may still be running',
    });
  });

  it('builds stable dedupe keys from type/run/session identifiers', () => {
    expect(buildFailureBubbleDedupeKey('upstream_failure', 'run-1', 'agent:main:test')).toBe(
      'upstream_failure:run-1:agent:main:test',
    );
  });

  it('disables assistant-content session parsing in strict activity mode', () => {
    expect(shouldParseAssistantContentForSessionDiscovery(true)).toBe(false);
    expect(shouldParseAssistantContentForSessionDiscovery(false)).toBe(true);
  });
});
