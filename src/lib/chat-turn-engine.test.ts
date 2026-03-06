import { describe, expect, it } from 'bun:test';
import { TurnLifecycleEngine, transitionTurnLifecycle } from './chat-turn-engine';

describe('chat turn lifecycle engine', () => {
  it('transitions through normal send lifecycle', () => {
    const engine = new TurnLifecycleEngine('queued', 1);

    expect(engine.transition('send_started', 2).to).toBe('sending');
    expect(engine.transition('stream_delta', 3).to).toBe('streaming');
    expect(engine.transition('settling_start', 4).to).toBe('settling');
    expect(engine.transition('complete', 5).to).toBe('completed');
    expect(engine.snapshot().phase).toBe('completed');
  });

  it('allows awaiting_output recovery path then completion', () => {
    const engine = new TurnLifecycleEngine('queued', 1);

    engine.transition('send_started', 2);
    expect(engine.transition('awaiting_output', 3).to).toBe('awaiting_output');
    expect(engine.transition('stream_delta', 4).to).toBe('streaming');
    expect(engine.transition('complete', 5).to).toBe('completed');
  });

  it('blocks non-terminal transitions after terminal state', () => {
    const engine = new TurnLifecycleEngine('queued', 1);

    engine.transition('send_started', 2);
    engine.transition('complete', 3);

    const blocked = engine.transition('stream_delta', 4);
    expect(blocked.changed).toBe(false);
    expect(blocked.to).toBe('completed');
  });

  it('keeps state unchanged for invalid transition graph edges', () => {
    const transition = transitionTurnLifecycle({ phase: 'queued', updatedAt: 1 }, 'settling_start', 2);
    expect(transition.changed).toBe(false);
    expect(transition.to).toBe('queued');
  });
});
