import { describe, expect, it } from 'bun:test';
import { buildLifecyclePrompt, getArtifactState } from './deliverable-lifecycle';

describe('deliverable lifecycle helpers', () => {
  it('derives artifact state from docs presence', () => {
    expect(getArtifactState({ docs: {} })).toEqual({ spec: 'missing', plan: 'missing' });
    expect(
      getArtifactState({ docs: { spec: '/workspace/docs/specs/item-spec.md', plan: '/workspace/docs/plans/item-plan.md' } }),
    ).toEqual({ spec: 'present', plan: 'present' });
  });

  it('builds create spec prompt when spec doc is missing', () => {
    const prompt = buildLifecyclePrompt('spec', {
      project: { id: 'project-1', title: 'Project One', dirPath: '/workspace/project-one' },
      item: { id: 'item-1', title: 'Item One', docs: {} },
    });

    expect(prompt).toContain('Create a new spec for this roadmap item at docs/specs/item-1-spec.md');
    expect(prompt).toContain('Spec doc: (missing)');
    expect(prompt).toContain('no Claude Code needed for specs');
  });

  it('builds update plan prompt without tmux-specific assumptions', () => {
    const prompt = buildLifecyclePrompt('plan', {
      project: { id: 'project-1', title: 'Project One', dirPath: '/workspace/project-one' },
      item: {
        id: 'item-1',
        title: 'Item One',
        docs: { plan: '/workspace/project-one/docs/plans/item-1-plan.md' },
      },
    });

    expect(prompt).toContain('Plan doc: docs/plans/item-1-plan.md');
    expect(prompt).toContain('Update the existing implementation plan using the best available coding-agent workflow');
    expect(prompt).toContain('Prefer an embedded coding-agent terminal if one is available');
    expect(prompt).toContain('Update the plan at docs/plans/item-1-plan.md.');
  });

  it('builds create plan prompt without tmux-specific assumptions when plan is missing', () => {
    const prompt = buildLifecyclePrompt('plan', {
      project: { id: 'project-1', title: 'Project One' },
      item: { id: 'feature-x', title: 'Feature X', docs: { spec: 'docs/specs/feature-x-spec.md' } },
    });

    expect(prompt).toContain('Create a new implementation plan using the best available coding-agent workflow');
    expect(prompt).toContain('Prefer an embedded coding-agent terminal if one is available');
    expect(prompt).toContain('docs/plans/feature-x-plan.md');
    expect(prompt).toContain('spec at docs/specs/feature-x-spec.md');
  });

  it('builds review prompt without hardcoded Claude Code instructions', () => {
    const prompt = buildLifecyclePrompt('review', {
      project: { id: 'project-1', title: 'Project One' },
      item: {
        id: 'item-1',
        title: 'Item One',
        docs: { plan: 'docs/plans/item-1-plan.md' },
      },
    });

    expect(prompt).toContain('Review the implementation plan using the best available review workflow');
    expect(prompt).toContain('Surface the recommended plan changes');
  });

  it('builds build prompt without tmux-specific assumptions', () => {
    const prompt = buildLifecyclePrompt('build', {
      project: { id: 'project-1', title: 'Project One' },
      item: {
        id: 'git-sync',
        title: 'Git Sync',
        docs: { spec: 'docs/specs/git-sync-spec.md', plan: 'docs/plans/git-sync-plan.md' },
      },
    });

    expect(prompt).toContain('Build this roadmap item using the best available coding-agent workflow');
    expect(prompt).toContain('Prefer an embedded coding-agent terminal if one is available');
    expect(prompt).toContain('supports a dedicated build workflow');
    expect(prompt).toContain('docs/plans/git-sync-plan.md');
    expect(prompt).toContain('Surface material decisions, blockers, or non-critical recommendations');
  });
});
