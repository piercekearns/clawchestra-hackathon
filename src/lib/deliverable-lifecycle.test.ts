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

    expect(prompt).toContain('Requested action: Create a new spec for this roadmap item under docs/specs/.');
    expect(prompt).toContain('Spec doc: (missing)');
  });

  it('builds update plan prompt with normalized relative path', () => {
    const prompt = buildLifecyclePrompt('plan', {
      project: { id: 'project-1', title: 'Project One', dirPath: '/workspace/project-one' },
      item: {
        id: 'item-1',
        title: 'Item One',
        docs: { plan: '/workspace/project-one/docs/plans/item-1-plan.md' },
      },
    });

    expect(prompt).toContain('Plan doc: docs/plans/item-1-plan.md');
    expect(prompt).toContain('Requested action: Update existing plan at docs/plans/item-1-plan.md');
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

    expect(prompt).toContain('/plan_review command / plan_review skill');
    expect(prompt).toContain('Surface the recommended plan changes');
  });
});
