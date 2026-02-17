import type { RoadmapItemDocs } from './schema';

export type DeliverableLifecycleAction = 'spec' | 'plan' | 'review' | 'deliver' | 'build';
export type ArtifactPresence = 'present' | 'missing';

export interface LifecycleArtifactState {
  spec: ArtifactPresence;
  plan: ArtifactPresence;
}

export interface LifecyclePromptProjectContext {
  id: string;
  title: string;
  dirPath?: string;
}

export interface LifecyclePromptItemContext {
  id: string;
  title: string;
  docs?: RoadmapItemDocs;
}

export interface LifecyclePromptContext {
  project: LifecyclePromptProjectContext;
  item: LifecyclePromptItemContext;
}

function normalizeDocPath(path: string | undefined, projectDir: string | undefined): string | undefined {
  if (!path) return undefined;
  if (!projectDir) return path;

  const normalizedPath = path.replace(/\\/g, '/');
  const normalizedProjectDir = projectDir.replace(/\\/g, '/').replace(/\/$/, '');

  if (normalizedPath === normalizedProjectDir) return '.';
  if (normalizedPath.startsWith(`${normalizedProjectDir}/`)) {
    return normalizedPath.slice(normalizedProjectDir.length + 1);
  }

  return path;
}

function formatDocLine(label: string, path: string | undefined): string {
  return `${label}: ${path ?? '(missing)'}`;
}

export function getArtifactState(item: { docs?: RoadmapItemDocs }): LifecycleArtifactState {
  return {
    spec: item.docs?.spec ? 'present' : 'missing',
    plan: item.docs?.plan ? 'present' : 'missing',
  };
}

function buildHeader(context: LifecyclePromptContext): string[] {
  const specPath = normalizeDocPath(context.item.docs?.spec, context.project.dirPath);
  const planPath = normalizeDocPath(context.item.docs?.plan, context.project.dirPath);

  return [
    `Project: ${context.project.title} (${context.project.id})`,
    `Roadmap item: ${context.item.title} (${context.item.id})`,
    formatDocLine('Spec doc', specPath),
    formatDocLine('Plan doc', planPath),
    '',
  ];
}

export function buildLifecyclePrompt(
  action: DeliverableLifecycleAction,
  context: LifecyclePromptContext,
): string {
  const artifactState = getArtifactState(context.item);
  const specPath = normalizeDocPath(context.item.docs?.spec, context.project.dirPath);
  const planPath = normalizeDocPath(context.item.docs?.plan, context.project.dirPath);

  const header = buildHeader(context);

  switch (action) {
    case 'spec': {
      if (artifactState.spec === 'present') {
        return [
          ...header,
          `Requested action: Update existing spec at ${specPath}`,
          'Update this roadmap item spec with current constraints and implementation details.',
          'Keep the spec concise and aligned with AGENTS.md document formatting rules.',
        ].join('\n');
      }

      return [
        ...header,
        'Requested action: Create new spec',
        'Create a new spec for this roadmap item under docs/specs/.',
        'Set ROADMAP nextAction to "Spec written — ready for plan/build" when done.',
      ].join('\n');
    }

    case 'plan': {
      if (artifactState.plan === 'present') {
        return [
          ...header,
          `Requested action: Update existing plan at ${planPath}`,
          'Update this implementation plan based on the latest scope and constraints.',
          'Keep phases concrete, testable, and implementation-ready.',
        ].join('\n');
      }

      const specReference = specPath
        ? `Use existing spec at ${specPath} as the source of truth.`
        : 'No spec exists yet; include explicit assumptions and scope boundaries.';

      return [
        ...header,
        'Requested action: Create new plan',
        'Create a new implementation plan under docs/plans/.',
        specReference,
        'Set ROADMAP nextAction to "Plan written — ready for build" when done.',
      ].join('\n');
    }

    case 'review': {
      const planReference = planPath
        ? `Use plan file: ${planPath}`
        : 'No plan file found. Create or update a plan first, then run review.';

      return [
        ...header,
        'Requested action: Review implementation plan',
        planReference,
        'Use the plan_review skill.',
        'Have @agent-dhh-rails-reviewer @agent-kieran-rails-reviewer @agent-code-simplicity-reviewer review this plan in parallel.',
      ].join('\n');
    }

    case 'deliver': {
      return [
        ...header,
        'Requested action: Deliver directly',
        'Implement this roadmap item directly in this repository now.',
        'Follow AGENTS.md rules, run relevant tests, and update ROADMAP nextAction to "Code shipped — awaiting verification" when code is shipped.',
      ].join('\n');
    }

    case 'build': {
      return [
        ...header,
        'Requested action: Run formal build workflow',
        'Execute the formal multi-step workflow for this roadmap item using /work.',
        'Use available spec/plan docs as source of truth and keep ROADMAP nextAction in sync while building.',
      ].join('\n');
    }

    default: {
      const _never: never = action;
      return _never;
    }
  }
}
