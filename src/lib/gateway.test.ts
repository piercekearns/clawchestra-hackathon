import { afterEach, describe, expect, it, mock } from 'bun:test';
import {
  checkGatewayConnection,
  parseAnnounceMetadata,
  sendMessage,
  sendMessageWithContext,
  type ChatMessage,
} from './gateway';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('gateway client', () => {
  it('returns assistant text for valid completion response', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: { content: 'hello from gateway' },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    ) as unknown as typeof fetch;

    const result = await sendMessage([{ role: 'user', content: 'hi' }]);

    expect(result.lastContent).toBe('hello from gateway');
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].content).toBe('hello from gateway');
  });

  it('prepends context message when sending with context', async () => {
    let capturedBody: unknown;

    globalThis.fetch = mock((_: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = init?.body;
      return Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: { content: 'ok' },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    }) as unknown as typeof fetch;

    const userMessages: ChatMessage[] = [{ role: 'user', content: 'status?' }];
    await sendMessageWithContext(userMessages, {
      view: 'projects',
      selectedProject: 'Pipeline Dashboard',
    });

    const parsed = JSON.parse(String(capturedBody)) as { messages: ChatMessage[] };
    expect(parsed.messages[0]).toEqual({
      role: 'system',
      content: 'User is viewing project: Pipeline Dashboard',
    });
    expect(parsed.messages[1]).toEqual(userMessages[0]);
  });

  it('does not leak UI metadata fields into gateway message payload', async () => {
    let capturedBody: unknown;

    globalThis.fetch = mock((_: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = init?.body;
      return Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: { content: 'ok' },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    }) as unknown as typeof fetch;

    await sendMessage([
      {
        role: 'user',
        content: 'status?',
        timestamp: 1234567890,
        _id: 'local-message-id',
        systemMeta: {
          kind: 'info',
          title: 'ignored',
        },
      },
    ]);

    const parsed = JSON.parse(String(capturedBody)) as { messages: Array<Record<string, unknown>> };
    expect(parsed.messages[0]).toEqual({
      role: 'user',
      content: 'status?',
    });
  });

  it('parses structured announce metadata', () => {
    const parsed = parseAnnounceMetadata({
      state: 'announce',
      label: 'Plan review',
      runtime: '2m 31s',
      status: 'completed',
      sessionKey: 'agent:main:pipeline-dashboard',
      runId: 'run_123',
    });

    expect(parsed).toEqual({
      label: 'Plan review',
      runtime: '2m 31s',
      status: 'ok',
      sessionKey: 'agent:main:pipeline-dashboard',
      runId: 'run_123',
      tokens: undefined,
    });
  });

  it('does not parse normal assistant text as announce metadata', () => {
    const parsed = parseAnnounceMetadata({
      message: 'Task completed. Here is your requested update.',
    });

    expect(parsed).toBeNull();
  });

  it('allows guarded fallback announce parsing only from event bus', () => {
    const parsed = parseAnnounceMetadata(
      {
        message: 'Sub-agent completed in background job',
        runId: 'run_abc',
      },
      true,
    );

    expect(parsed).toEqual({
      status: 'ok',
      runId: 'run_abc',
    });
  });

  it('returns false when gateway is unreachable', async () => {
    globalThis.fetch = mock(
      () => Promise.reject(new Error('offline')),
    ) as unknown as typeof fetch;
    await expect(checkGatewayConnection()).resolves.toBe(false);
  });

  it('returns true when gateway models endpoint returns valid JSON', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(JSON.stringify({ data: [{ id: 'gpt-4.1' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    ) as unknown as typeof fetch;

    await expect(checkGatewayConnection()).resolves.toBe(true);
  });

  it('returns false when gateway models endpoint responds with html', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response('<html></html>', {
          status: 200,
          headers: { 'Content-Type': 'text/html' },
        }),
      ),
    ) as unknown as typeof fetch;

    await expect(checkGatewayConnection()).resolves.toBe(false);
  });

  it('throws when gateway returns invalid payload shape', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(JSON.stringify({ nope: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    ) as unknown as typeof fetch;

    await expect(sendMessage([{ role: 'user', content: 'test' }])).rejects.toThrow(
      'Unexpected response shape from gateway',
    );
  });

  it('throws when gateway responds with non-json content', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response('<html>ok</html>', {
          status: 200,
          headers: { 'Content-Type': 'text/html' },
        }),
      ),
    ) as unknown as typeof fetch;

    await expect(sendMessage([{ role: 'user', content: 'test' }])).rejects.toThrow(
      'Gateway returned non-JSON response. Check OpenClaw API endpoint.',
    );
  });

  it('encodes image attachments as image_url message parts', async () => {
    let capturedBody: unknown;

    globalThis.fetch = mock((_: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = init?.body;
      return Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: { content: 'ok' },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    }) as unknown as typeof fetch;

    await sendMessage(
      [{ role: 'user', content: 'what is in this image?' }],
      {
        attachments: [
          {
            name: 'mock.png',
            mediaType: 'image/png',
            dataUrl: 'data:image/png;base64,AA==',
          },
        ],
      },
    );

    const parsed = JSON.parse(String(capturedBody)) as {
      messages: Array<{ role: string; content: string | Array<Record<string, unknown>> }>;
    };

    const message = parsed.messages[0];
    expect(message.role).toBe('user');
    expect(Array.isArray(message.content)).toBe(true);
    expect(message.content).toEqual([
      { type: 'text', text: 'what is in this image?' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AA==' } },
    ]);
  });
});
