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
          `Requested action: Update existing spec at ${specPath}. Keep the spec concise and aligned with AGENTS.md document formatting rules. You can write this directly (no Claude Code needed for specs).`,
        ].join('\n');
      }

      return [
        ...header,
        `Requested action: Create a new spec for this roadmap item at docs/specs/${context.item.id}-spec.md. Keep it concise and aligned with AGENTS.md document formatting rules. You can write this directly (no Claude Code needed for specs). Update nextAction in .clawchestra/state.json to "Spec written — ready for plan/build" when done.`,
      ].join('\n');
    }

    case 'plan': {
      if (artifactState.plan === 'present') {
        return [
          ...header,
          'Requested action: Update the existing implementation plan using the best available coding-agent workflow for this environment.',
          '',
          'Steps:',
          '1. Prefer an embedded coding-agent terminal if one is available; otherwise work directly in the repo from the current environment.',
          `2. Update the plan at ${planPath}.`,
          '3. Keep phases concrete, testable, and implementation-ready.',
          '4. Surface any material decisions or scope changes to the user before locking them in.',
        ].join('\n');
      }

      const specReference = specPath
        ? `Use existing spec at ${specPath} as the source of truth.`
        : 'No spec exists yet; include explicit assumptions and scope boundaries.';

      return [
        ...header,
        'Requested action: Create a new implementation plan using the best available coding-agent workflow for this environment.',
        '',
        'Steps:',
        '1. Prefer an embedded coding-agent terminal if one is available; otherwise work directly in the repo from the current environment.',
        `2. Create the plan at docs/plans/${context.item.id}-plan.md.`,
        `3. ${specReference}`,
        '4. Surface any material decisions or scope changes to the user before locking them in.',
        '5. Update nextAction in .clawchestra/state.json to "Plan written — ready for build" when done.',
      ].join('\n');
    }

    case 'review': {
      const planRef = planPath ? ` The plan to review is: ${planPath}` : '';
      return [
        ...header,
        `Requested action: Review the implementation plan using the best available review workflow in the current coding-agent environment.${planRef}`,
        'Outputs: Surface the recommended plan changes to the user so they can decide next steps.',
      ].join('\n');
    }

    case 'deliver': {
      const sources: string[] = [];
      if (specPath) sources.push(`spec at ${specPath}`);
      if (planPath) sources.push(`plan at ${planPath}`);
      const sourceRef = sources.length > 0
        ? ` Use ${sources.join(' and ')} as source of truth.`
        : '';

      return [
        ...header,
        `Requested action: Deliver directly. Implement this roadmap item in this repository now.${sourceRef} Follow AGENTS.md rules, run relevant tests, and update nextAction in .clawchestra/state.json to "Code shipped — awaiting verification" when code is shipped.`,
      ].join('\n');
    }

    case 'build': {
      const sources: string[] = [];
      if (specPath) sources.push(`spec at ${specPath}`);
      if (planPath) sources.push(`plan at ${planPath}`);
      const sourceRef = sources.length > 0
        ? `Source of truth: ${sources.join(' and ')}.`
        : '';

      return [
        ...header,
        'Requested action: Build this roadmap item using the best available coding-agent workflow for this environment.',
        '',
        'Steps:',
        '1. Prefer an embedded coding-agent terminal if one is available; otherwise work directly in the repo from the current environment.',
        '2. If the current coding-agent environment supports a dedicated build workflow, use it. Otherwise execute the work directly from the plan/spec.',
        `3. Build against ${planPath ?? '<path-to-plan>'} and keep implementation aligned with the available spec/plan docs.`,
        '4. Keep .clawchestra/state.json nextAction in sync throughout the build.',
        '5. Surface material decisions, blockers, or non-critical recommendations to the user.',
        sourceRef,
      ].filter(Boolean).join('\n');
    }

    default: {
      const _never: never = action;
      return _never;
    }
  }
}
