import { afterEach, describe, expect, it, mock } from 'bun:test';
import {
  __gatewayTestUtils,
  checkGatewayConnection,
  parseAnnounceMetadata,
  sendMessage,
  sendMessageWithContext,
  type ChatMessage,
} from './gateway';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  __gatewayTestUtils.clearTurnRegistryForTests();
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
      selectedProject: 'Clawchestra',
    });

    const parsed = JSON.parse(String(capturedBody)) as { messages: ChatMessage[] };
    expect(parsed.messages[0]).toEqual({
      role: 'system',
      content: 'User is viewing project: Clawchestra',
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
      sessionKey: 'agent:main:clawchestra',
      runId: 'run_123',
    });

    expect(parsed).toEqual({
      label: 'Plan review',
      runtime: '2m 31s',
      status: 'ok',
      sessionKey: 'agent:main:clawchestra',
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

  it('extracts assistant messages anchored to the triggering user turn', () => {
    const messages = [
      { id: 'u-old', role: 'user', content: 'old message', timestamp: 1 },
      { id: 'a-old', role: 'assistant', content: 'old reply', timestamp: 2 },
      {
        id: 'u-1',
        role: 'user',
        content: 'User is viewing project: Clawchestra\n\nHello there',
        timestamp: 10,
      },
      { id: 'a-1', role: 'assistant', content: 'first answer', timestamp: 11 },
      { id: 'a-2', role: 'assistant', content: 'second answer', timestamp: 12 },
      { id: 'u-2', role: 'user', content: 'next user turn', timestamp: 13 },
      { id: 'a-3', role: 'assistant', content: 'later answer', timestamp: 14 },
    ];

    const extracted = __gatewayTestUtils.extractAssistantMessagesForTurn(messages, {
      baselineIds: new Set(['u-old', 'a-old']),
      minTimestamp: 5,
      expectedUserText: 'User is viewing project: Clawchestra   Hello there',
    });

    expect(extracted.map((message) => message._id)).toEqual(['a-1', 'a-2']);
    expect(extracted.map((message) => message.content)).toEqual(['first answer', 'second answer']);
  });

  it('prefers run-scoped history messages when runId is available', () => {
    const messages = [
      { id: 'u-1', role: 'user', content: 'prompt', timestamp: 10 },
      { id: 'a-other', role: 'assistant', content: 'from other run', timestamp: 11, runId: 'run-other' },
      { id: 'a-own', role: 'assistant', content: 'from own run', timestamp: 12, runId: 'run-own' },
      { id: 'u-2', role: 'user', content: 'next prompt', timestamp: 13 },
    ];

    const extracted = __gatewayTestUtils.extractAssistantMessagesForTurn(messages, {
      baselineIds: new Set(),
      minTimestamp: 0,
      expectedUserText: 'prompt',
      expectedRunId: 'run-own',
    });

    expect(extracted.map((message) => message._id)).toEqual(['a-own']);
    expect(extracted[0]?.content).toBe('from own run');
  });

  it('falls back to first new user turn when expected text is transformed', () => {
    const messages = [
      { id: 'u-1', role: 'user', content: 'wrapped context + prompt', timestamp: 10 },
      { id: 'a-1', role: 'assistant', content: 'assistant response', timestamp: 11 },
      { id: 'u-2', role: 'user', content: 'another prompt', timestamp: 12 },
      { id: 'a-2', role: 'assistant', content: 'another response', timestamp: 13 },
    ];

    const extracted = __gatewayTestUtils.extractAssistantMessagesForTurn(messages, {
      baselineIds: new Set(),
      minTimestamp: 5,
      expectedUserText: 'this exact text does not exist',
    });

    expect(extracted.map((message) => message._id)).toEqual(['a-1']);
    expect(extracted[0]?.content).toBe('assistant response');
  });

  it('ignores synthetic exec-completed user entries as turn boundaries', () => {
    const messages = [
      { id: 'u-1', role: 'user', content: 'actual prompt', timestamp: 10 },
      { id: 'a-1', role: 'assistant', content: 'step one', timestamp: 11 },
      {
        id: 'u-sys',
        role: 'user',
        content: 'System: [2026-02-18 02:21:14 GMT] Exec completed (young-ro, code 0) :: build output',
        timestamp: 12,
      },
      { id: 'a-2', role: 'assistant', content: 'Build ready - Update to test.', timestamp: 13 },
      { id: 'u-2', role: 'user', content: 'next real prompt', timestamp: 14 },
      { id: 'a-3', role: 'assistant', content: 'next turn reply', timestamp: 15 },
    ];

    const extracted = __gatewayTestUtils.extractAssistantMessagesForTurn(messages, {
      baselineIds: new Set(),
      minTimestamp: 0,
      expectedUserText: 'actual prompt',
    });

    expect(extracted.map((message) => message._id)).toEqual(['a-1', 'a-2']);
  });

  it('ignores synthetic exec user entries when status is not "completed"', () => {
    const messages = [
      { id: 'u-1', role: 'user', content: 'actual prompt', timestamp: 10 },
      { id: 'a-1', role: 'assistant', content: 'step one', timestamp: 11 },
      {
        id: 'u-sys',
        role: 'user',
        content: 'System: [2026-02-18 02:21:14 GMT] Exec failed (agent-x, code 1) :: build output',
        timestamp: 12,
      },
      { id: 'a-2', role: 'assistant', content: 'recovered and completed', timestamp: 13 },
      { id: 'u-2', role: 'user', content: 'next real prompt', timestamp: 14 },
    ];

    const extracted = __gatewayTestUtils.extractAssistantMessagesForTurn(messages, {
      baselineIds: new Set(),
      minTimestamp: 0,
      expectedUserText: 'actual prompt',
    });

    expect(extracted.map((message) => message._id)).toEqual(['a-1', 'a-2']);
  });

  it('does not anchor on synthetic exec-completed user entries', () => {
    const messages = [
      {
        id: 'u-sys',
        role: 'user',
        content: 'System: [2026-02-18 02:21:14 GMT] Exec completed (nova-orb, code 0) :: test output',
        timestamp: 10,
      },
      { id: 'u-1', role: 'user', content: 'real prompt', timestamp: 11 },
      { id: 'a-1', role: 'assistant', content: 'real reply', timestamp: 12 },
    ];

    const extracted = __gatewayTestUtils.extractAssistantMessagesForTurn(messages, {
      baselineIds: new Set(),
      minTimestamp: 0,
      expectedUserText: 'missing transformed text',
    });

    expect(extracted.map((message) => message._id)).toEqual(['a-1']);
  });

  it('detects accepted user turn when wrapped text is present in history', () => {
    const messages = [
      { id: 'u-old', role: 'user', content: 'old turn', timestamp: 1 },
      {
        id: 'u-new',
        role: 'user',
        content: 'User workspace path: /Users/piercekearns/clawdbot-sandbox\n\nrun /build now',
        timestamp: 10,
      },
    ];

    const matched = __gatewayTestUtils.hasMatchingUserTurnInHistory(messages, {
      baselineIds: new Set(['u-old']),
      minTimestamp: 5,
      expectedUserText: 'User workspace path: /Users/piercekearns/clawdbot-sandbox run /build now',
    });

    expect(matched).toBe(true);
  });

  it('detects accepted user turn when marker-wrapped text is present in history', () => {
    const messages = [
      {
        id: 'u-new',
        role: 'user',
        content:
          'User is viewing project: Clawchestra\n\nUser request:\nRun /plan_review now',
        timestamp: 10,
      },
    ];

    const matched = __gatewayTestUtils.hasMatchingUserTurnInHistory(messages, {
      baselineIds: new Set(),
      minTimestamp: 5,
      expectedUserText: 'User is viewing project: Clawchestra User request: Run /plan_review now',
    });

    expect(matched).toBe(true);
  });

  it('does not report accepted user turn when only unrelated new turns exist', () => {
    const messages = [
      { id: 'u-new', role: 'user', content: 'totally different prompt', timestamp: 10 },
    ];

    const matched = __gatewayTestUtils.hasMatchingUserTurnInHistory(messages, {
      baselineIds: new Set(),
      minTimestamp: 5,
      expectedUserText: 'expected prompt text',
    });

    expect(matched).toBe(false);
  });

  it('marks in-progress assistant snippets as needing settle pass', () => {
    const needsSettle = __gatewayTestUtils.likelyNeedsFinalSettlePass([
      { role: 'assistant', content: 'Now update the Column component with collapsed/expanded variants:' },
    ]);

    expect(needsSettle).toBe(true);
  });

  it('does not mark complete assistant sentences as needing settle pass', () => {
    const needsSettle = __gatewayTestUtils.likelyNeedsFinalSettlePass([
      { role: 'assistant', content: 'Build ready. Update to test.' },
    ]);

    expect(needsSettle).toBe(false);
  });

  it('treats process poll status=completed as terminal even without exitCode', () => {
    const snapshot = __gatewayTestUtils.parseProcessPollSnapshot({
      status: 'completed',
    });

    expect(snapshot).toEqual({
      terminal: true,
      exitCode: 0,
    });
  });

  it('treats process poll state=failed as terminal failure without exitCode', () => {
    const snapshot = __gatewayTestUtils.parseProcessPollSnapshot({
      state: 'failed',
      error: 'synthetic transcript repair error',
    });

    expect(snapshot).toEqual({
      terminal: true,
      exitCode: 1,
      error: 'synthetic transcript repair error',
    });
  });

  it('reads terminal process snapshot from nested payload object', () => {
    const snapshot = __gatewayTestUtils.parseProcessPollSnapshot({
      payload: {
        completed: true,
      },
    });

    expect(snapshot).toEqual({
      terminal: true,
      exitCode: 0,
    });
  });

  it('classifies process poll scope failures as unavailable_scope', () => {
    const capability = __gatewayTestUtils.classifyProcessPollCapability(
      new Error('missing scope: operator.admin'),
      1,
      3,
    );

    expect(capability).toBe('unavailable_scope');
  });

  it('classifies below-threshold failures as unavailable_transient', () => {
    const capability = __gatewayTestUtils.classifyProcessPollCapability(
      new Error('temporary gateway failure'),
      1,
      3,
    );

    expect(capability).toBe('unavailable_transient');
  });

  it('classifies threshold failures as unavailable_degraded', () => {
    const capability = __gatewayTestUtils.classifyProcessPollCapability(
      new Error('process poll timeout'),
      3,
      3,
    );

    expect(capability).toBe('unavailable_degraded');
  });

  it('estimates chat.send frame payload size for guardrail checks', () => {
    const size = __gatewayTestUtils.estimateChatSendFrameBytes({
      sessionKey: 'agent:main:clawchestra',
      message: 'hello',
      deliver: false,
      idempotencyKey: 'run-1',
    });

    expect(size).toBeGreaterThan(0);
    expect(size).toBeLessThan(__gatewayTestUtils.OPENCLAW_WS_CLIENT_PAYLOAD_BUDGET_BYTES);
  });

  it('detects oversized chat.send frame payloads', () => {
    const size = __gatewayTestUtils.estimateChatSendFrameBytes({
      sessionKey: 'agent:main:clawchestra',
      message: 'hello',
      deliver: false,
      idempotencyKey: 'run-1',
      attachments: [
        {
          type: 'image',
          mimeType: 'image/jpeg',
          content: 'A'.repeat(700_000),
        },
      ],
    });

    expect(size).toBeGreaterThan(__gatewayTestUtils.OPENCLAW_WS_CLIENT_PAYLOAD_BUDGET_BYTES);
  });

  it('counts only active lifecycle turns', () => {
    __gatewayTestUtils.upsertTurnForTests({
      turnToken: 'turn-a',
      sessionKey: 'agent:main:clawchestra',
      status: 'queued',
      submittedAt: 1,
      lastSignalAt: 1,
      hasAssistantOutput: false,
    });
    __gatewayTestUtils.upsertTurnForTests({
      turnToken: 'turn-b',
      sessionKey: 'agent:main:clawchestra',
      status: 'running',
      submittedAt: 2,
      lastSignalAt: 2,
      hasAssistantOutput: false,
    });
    __gatewayTestUtils.upsertTurnForTests({
      turnToken: 'turn-c',
      sessionKey: 'agent:main:clawchestra',
      status: 'awaiting_output',
      submittedAt: 3,
      lastSignalAt: 3,
      hasAssistantOutput: false,
    });
    __gatewayTestUtils.upsertTurnForTests({
      turnToken: 'turn-d',
      sessionKey: 'agent:main:clawchestra',
      status: 'completed',
      submittedAt: 4,
      lastSignalAt: 4,
      completedAt: 5,
      hasAssistantOutput: true,
    });

    expect(__gatewayTestUtils.getActiveTurnCount()).toBe(3);
  });

  it('filters recovery history to entries after the cursor message', () => {
    const filtered = __gatewayTestUtils.applyRecoveryCursorFilter(
      [
        { id: 'm-1', role: 'assistant', content: 'older', timestamp: 1000 },
        { id: 'm-2', role: 'assistant', content: 'cursor', timestamp: 2000 },
        { id: 'm-3', role: 'assistant', content: 'newer', timestamp: 2100 },
      ],
      {
        sessionKey: 'agent:main:clawchestra',
        lastMessageId: 'm-2',
        lastTimestamp: 2000,
      },
    );

    expect(filtered.map((message) => message.id)).toEqual(['m-3']);
  });

  it('falls back to bounded cursor window when nothing is newer', () => {
    const filtered = __gatewayTestUtils.applyRecoveryCursorFilter(
      [
        { id: 'm-1', role: 'assistant', content: 'too old', timestamp: 900_000 },
        { id: 'm-2', role: 'assistant', content: 'recent', timestamp: 930_000 },
      ],
      {
        sessionKey: 'agent:main:clawchestra',
        lastMessageId: 'cursor-id',
        lastTimestamp: 1_000_000,
      },
    );

    expect(filtered.map((message) => message.id)).toEqual(['m-2']);
  });

  it('does not re-include the exact cursor message during bounded fallback', () => {
    const filtered = __gatewayTestUtils.applyRecoveryCursorFilter(
      [
        { id: 'cursor-id', role: 'assistant', content: 'cursor', timestamp: 1_000_000 },
        { id: 'm-2', role: 'assistant', content: 'recent', timestamp: 930_000 },
      ],
      {
        sessionKey: 'agent:main:clawchestra',
        lastMessageId: 'cursor-id',
        lastTimestamp: 1_000_000,
      },
    );

    expect(filtered.map((message) => message.id)).toEqual(['m-2']);
  });

  it('detects internal no-reply runs from assistant history', () => {
    const runIds = __gatewayTestUtils.collectInternalNoReplyRunIds([
      { role: 'assistant', runId: 'run-1', content: 'NO_REPLY', timestamp: 1000 },
      { role: 'assistant', runId: 'run-2', content: 'Normal reply', timestamp: 1001 },
      { role: 'assistant', runId: 'run-3', content: 'NO REPLY', timestamp: 1002 },
    ]);

    expect([...runIds].sort()).toEqual(['run-1', 'run-3']);
  });

  it('suppresses assistant messages for internal no-reply runs', () => {
    const noReplyRunIds = new Set(['run-1']);

    expect(
      __gatewayTestUtils.shouldSuppressNoReplyRunAssistantMessage(
        { role: 'assistant', runId: 'run-1', content: 'File exists, appending note', timestamp: 1000 },
        noReplyRunIds,
      ),
    ).toBe(true);

    expect(
      __gatewayTestUtils.shouldSuppressNoReplyRunAssistantMessage(
        { role: 'assistant', runId: 'run-2', content: 'Normal reply', timestamp: 1001 },
        noReplyRunIds,
      ),
    ).toBe(false);

    expect(
      __gatewayTestUtils.shouldSuppressNoReplyRunAssistantMessage(
        { role: 'assistant', content: 'NO_REPLY', timestamp: 1002 },
        noReplyRunIds,
      ),
    ).toBe(true);
  });

  it('maps compaction state semantics to distinct progress/completion metadata', () => {
    expect(__gatewayTestUtils.resolveCompactionPresentation('compacting', true)).toEqual({
      title: 'Compacting conversation...',
      loading: true,
      status: 'In progress',
    });
    expect(__gatewayTestUtils.resolveCompactionPresentation('compaction_complete', true)).toEqual({
      title: 'Conversation compacted',
      loading: false,
      status: 'Complete',
    });
  });

  it('expires stale active turns during hydration replay', () => {
    const now = 1_000_000;
    // Hydration uses a shorter window (2 min) than active-run timeout (12 min)
    // because at startup there's no WS connection confirming the run is alive.

    expect(
      __gatewayTestUtils.isPendingTurnExpiredForHydration(
        { status: 'running', lastSignalAt: now - (2 * 60_000 + 1) },
        now,
      ),
    ).toBe(true);

    expect(
      __gatewayTestUtils.isPendingTurnExpiredForHydration(
        { status: 'running', lastSignalAt: now - (2 * 60_000 - 1) },
        now,
      ),
    ).toBe(false);

    expect(
      __gatewayTestUtils.isPendingTurnExpiredForHydration(
        { status: 'completed', lastSignalAt: now - (12 * 60_000 + 60_000) },
        now,
      ),
    ).toBe(false);
  });
});
