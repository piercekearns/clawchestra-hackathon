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

  it('builds update plan prompt with tmux steps and normalized path', () => {
    const prompt = buildLifecyclePrompt('plan', {
      project: { id: 'project-1', title: 'Project One', dirPath: '/workspace/project-one' },
      item: {
        id: 'item-1',
        title: 'Item One',
        docs: { plan: '/workspace/project-one/docs/plans/item-1-plan.md' },
      },
    });

    expect(prompt).toContain('Plan doc: docs/plans/item-1-plan.md');
    expect(prompt).toContain('Update the existing implementation plan using Claude Code via tmux');
    expect(prompt).toContain('coding-agent skill');
    expect(prompt).toContain('tmux new-session');
    expect(prompt).toContain('/plan docs/plans/item-1-plan.md');
  });

  it('builds create plan prompt with tmux steps when plan is missing', () => {
    const prompt = buildLifecyclePrompt('plan', {
      project: { id: 'project-1', title: 'Project One' },
      item: { id: 'feature-x', title: 'Feature X', docs: { spec: 'docs/specs/feature-x-spec.md' } },
    });

    expect(prompt).toContain('Create a new implementation plan using Claude Code via tmux');
    expect(prompt).toContain('tmux new-session -d -s feature-x-plan');
    expect(prompt).toContain('/plan docs/plans/feature-x-plan.md');
    expect(prompt).toContain('spec at docs/specs/feature-x-spec.md');
  });

  it('builds review prompt referencing plan_review skill', () => {
    const prompt = buildLifecyclePrompt('review', {
      project: { id: 'project-1', title: 'Project One' },
      item: {
        id: 'item-1',
        title: 'Item One',
        docs: { plan: 'docs/plans/item-1-plan.md' },
      },
    });

    expect(prompt).toContain('Run /plan_review in Claude Code');
    expect(prompt).toContain('NOT /review');
    expect(prompt).toContain('Surface the recommended plan changes');
  });

  it('builds build prompt with explicit tmux steps', () => {
    const prompt = buildLifecyclePrompt('build', {
      project: { id: 'project-1', title: 'Project One' },
      item: {
        id: 'git-sync',
        title: 'Git Sync',
        docs: { spec: 'docs/specs/git-sync-spec.md', plan: 'docs/plans/git-sync-plan.md' },
      },
    });

    expect(prompt).toContain('Build this roadmap item using Claude Code via tmux');
    expect(prompt).toContain('coding-agent skill');
    expect(prompt).toContain('tmux new-session -d -s git-sync-build');
    expect(prompt).toContain('claude --dangerously-skip-permissions');
    expect(prompt).toContain('/build docs/plans/git-sync-plan.md');
    expect(prompt).toContain('Surface non-critical recommendations');
    expect(prompt).toContain('Kill tmux session when complete');
  });
});
