import type { PointerEvent } from 'react';
import { FileText, Hammer, ListChecks, Search } from 'lucide-react';
import type { DeliverableLifecycleAction } from '../lib/deliverable-lifecycle';
import { CrossedHammers } from './icons/CrossedHammers';

interface LifecycleActionBarProps {
  specExists: boolean;
  planExists: boolean;
  onAction: (action: DeliverableLifecycleAction) => void;
}

function stopCardEvent(event: PointerEvent<HTMLElement>) {
  event.stopPropagation();
}

function actionButtonClass(filled: boolean): string {
  return [
    'inline-flex h-7 w-7 items-center justify-center rounded-md border transition-colors',
    filled
      ? 'border-revival-accent-400/80 bg-revival-accent-200/30 text-neutral-900 dark:text-neutral-100'
      : 'border-neutral-300/70 text-neutral-700 hover:border-revival-accent-400 hover:text-neutral-900 dark:border-neutral-600 dark:text-neutral-300 dark:hover:text-neutral-100',
  ].join(' ');
}

export function LifecycleActionBar({ specExists, planExists, onAction }: LifecycleActionBarProps) {
  return (
    <div className="grid w-full grid-cols-5 gap-1">
      <button
        type="button"
        className={actionButtonClass(specExists)}
        onPointerDown={stopCardEvent}
        onClick={(event) => {
          event.stopPropagation();
          onAction('spec');
        }}
        title={specExists ? 'Update Spec' : 'Create Spec'}
        aria-label={specExists ? 'Update Spec' : 'Create Spec'}
      >
        <FileText className="h-4 w-4" fill={specExists ? 'currentColor' : 'none'} />
      </button>

      <button
        type="button"
        className={actionButtonClass(planExists)}
        onPointerDown={stopCardEvent}
        onClick={(event) => {
          event.stopPropagation();
          onAction('plan');
        }}
        title={planExists ? 'Update Plan' : 'Create Plan'}
        aria-label={planExists ? 'Update Plan' : 'Create Plan'}
      >
        <ListChecks className="h-4 w-4" fill={planExists ? 'currentColor' : 'none'} />
      </button>

      <button
        type="button"
        className={actionButtonClass(false)}
        onPointerDown={stopCardEvent}
        onClick={(event) => {
          event.stopPropagation();
          onAction('review');
        }}
        title="Plan Review"
        aria-label="Plan Review"
      >
        <Search className="h-4 w-4" />
      </button>

      <button
        type="button"
        className={actionButtonClass(false)}
        onPointerDown={stopCardEvent}
        onClick={(event) => {
          event.stopPropagation();
          onAction('deliver');
        }}
        title="Deliver"
        aria-label="Deliver"
      >
        <Hammer className="h-4 w-4" />
      </button>

      <button
        type="button"
        className={actionButtonClass(false)}
        onPointerDown={stopCardEvent}
        onClick={(event) => {
          event.stopPropagation();
          onAction('build');
        }}
        title="Build Workflow"
        aria-label="Build Workflow"
      >
        <CrossedHammers className="h-4 w-4" />
      </button>
    </div>
  );
}
