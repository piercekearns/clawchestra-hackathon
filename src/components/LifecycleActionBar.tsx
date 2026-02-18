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

/**
 * Proton-style action icons: bare by default, subtle container on hover.
 * Filled/colored icons indicate existing artifacts (spec, plan).
 */
function actionButtonClass(filled: boolean): string {
  return [
    'inline-flex h-6 w-6 items-center justify-center rounded transition-all',
    // No border or background by default — bare icon
    // Higher contrast: neutral-600/500 instead of 400/500
    filled
      ? 'text-revival-accent-500 dark:text-revival-accent-400'
      : 'text-neutral-500 dark:text-neutral-400',
    // Hover: subtle container with shadow (Proton style)
    'hover:bg-neutral-200/70 hover:text-neutral-900 hover:shadow-sm',
    'dark:hover:bg-neutral-600/50 dark:hover:text-neutral-100',
  ].join(' ');
}

const ICON_SIZE = 'h-[15px] w-[15px]';

export function LifecycleActionBar({ specExists, planExists, onAction }: LifecycleActionBarProps) {
  return (
    <div className="flex h-full w-full items-center justify-start gap-1">
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
        <FileText className={ICON_SIZE} fill={specExists ? 'currentColor' : 'none'} />
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
        <ListChecks className={ICON_SIZE} fill={planExists ? 'currentColor' : 'none'} />
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
        <Search className={ICON_SIZE} />
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
        <Hammer className={ICON_SIZE} />
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
        <CrossedHammers className={ICON_SIZE} />
      </button>
    </div>
  );
}
