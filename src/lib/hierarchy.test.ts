import { describe, expect, it } from 'bun:test';
import { buildHierarchy } from './hierarchy';
import type { ProjectViewModel } from './schema';

function project(
  id: string,
  priority: number,
  parent?: string,
): ProjectViewModel {
  return {
    id,
    title: id,
    status: 'up-next',
    filePath: `/tmp/${id}/CLAWCHESTRA.md`,
    dirPath: `/tmp/${id}`,
    frontmatter: {
      title: id,
      status: 'up-next',
      type: parent ? 'sub-project' : 'project',
      priority,
      parent,
    },
    content: '',
    hasRoadmap: false,
    hasChangelog: false,
    hasGit: false,
    children: [],
    isStale: false,
    needsReview: false,
    hasRepo: false,
  };
}

describe('buildHierarchy', () => {
  it('nests children under parent and sorts by priority', () => {
    const parent = project('parent', 2);
    const childA = project('child-a', 2, 'parent');
    const childB = project('child-b', 1, 'parent');
    const rootA = project('root-a', 2);
    const rootB = project('root-b', 1);

    const roots = buildHierarchy([childA, rootA, parent, childB, rootB]);

    expect(roots.map((entry) => entry.id)).toEqual(['root-b', 'root-a', 'parent']);
    expect(roots[2].children.map((entry) => entry.id)).toEqual(['child-b', 'child-a']);
  });

  it('keeps orphaned children at root level', () => {
    const orphan = project('orphan', 1, 'missing-parent');

    const roots = buildHierarchy([orphan]);

    expect(roots).toHaveLength(1);
    expect(roots[0].id).toBe('orphan');
  });
});
