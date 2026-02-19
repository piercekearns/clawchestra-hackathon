export type TurnLifecyclePhase =
  | 'queued'
  | 'sending'
  | 'streaming'
  | 'awaiting_output'
  | 'settling'
  | 'completed'
  | 'failed'
  | 'timed_out';

export type TurnLifecycleEvent =
  | 'send_started'
  | 'send_acknowledged'
  | 'stream_delta'
  | 'awaiting_output'
  | 'settling_start'
  | 'complete'
  | 'fail'
  | 'timeout';

export interface TurnLifecycleState {
  phase: TurnLifecyclePhase;
  updatedAt: number;
}

export interface TurnLifecycleTransition {
  from: TurnLifecyclePhase;
  to: TurnLifecyclePhase;
  event: TurnLifecycleEvent;
  changed: boolean;
  updatedAt: number;
}

const TERMINAL_PHASES = new Set<TurnLifecyclePhase>(['completed', 'failed', 'timed_out']);

function canTransition(from: TurnLifecyclePhase, to: TurnLifecyclePhase): boolean {
  if (from === to) return true;
  if (TERMINAL_PHASES.has(from)) return false;

  switch (from) {
    case 'queued':
      return to === 'sending' || to === 'failed' || to === 'timed_out';
    case 'sending':
      return (
        to === 'streaming' ||
        to === 'awaiting_output' ||
        to === 'settling' ||
        to === 'completed' ||
        to === 'failed' ||
        to === 'timed_out'
      );
    case 'streaming':
      return (
        to === 'streaming' ||
        to === 'settling' ||
        to === 'awaiting_output' ||
        to === 'completed' ||
        to === 'failed' ||
        to === 'timed_out'
      );
    case 'awaiting_output':
      return (
        to === 'streaming' ||
        to === 'settling' ||
        to === 'completed' ||
        to === 'failed' ||
        to === 'timed_out'
      );
    case 'settling':
      return to === 'completed' || to === 'failed' || to === 'timed_out';
    default:
      return false;
  }
}

function eventToPhase(event: TurnLifecycleEvent, current: TurnLifecyclePhase): TurnLifecyclePhase {
  switch (event) {
    case 'send_started':
    case 'send_acknowledged':
      return 'sending';
    case 'stream_delta':
      return 'streaming';
    case 'awaiting_output':
      return 'awaiting_output';
    case 'settling_start':
      return 'settling';
    case 'complete':
      return 'completed';
    case 'fail':
      return 'failed';
    case 'timeout':
      return 'timed_out';
    default:
      return current;
  }
}

export function transitionTurnLifecycle(
  current: TurnLifecycleState,
  event: TurnLifecycleEvent,
  at: number = Date.now(),
): TurnLifecycleTransition {
  const target = eventToPhase(event, current.phase);
  const next = canTransition(current.phase, target) ? target : current.phase;
  const changed = next !== current.phase;

  return {
    from: current.phase,
    to: next,
    event,
    changed,
    updatedAt: at,
  };
}

export class TurnLifecycleEngine {
  private state: TurnLifecycleState;

  constructor(initial: TurnLifecyclePhase = 'queued', now: number = Date.now()) {
    this.state = {
      phase: initial,
      updatedAt: now,
    };
  }

  snapshot(): TurnLifecycleState {
    return { ...this.state };
  }

  transition(event: TurnLifecycleEvent, at: number = Date.now()): TurnLifecycleTransition {
    const transition = transitionTurnLifecycle(this.state, event, at);
    this.state = {
      phase: transition.to,
      updatedAt: transition.updatedAt,
    };
    return transition;
  }
}
