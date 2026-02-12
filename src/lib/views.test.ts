import { describe, expect, it } from 'bun:test';
import { defaultView, projectRoadmapView } from './views';

describe('views', () => {
  it('creates the default dashboard view', () => {
    const view = defaultView();

    expect(view.type).toBe('projects');
    expect(view.breadcrumbs).toEqual([{ id: 'root', label: 'Dashboard' }]);
    expect(view.columns.length).toBeGreaterThan(0);
  });

  it('creates a roadmap drill-down view', () => {
    const view = projectRoadmapView('pipeline-dashboard', 'Pipeline Dashboard');

    expect(view.type).toBe('roadmap');
    if (view.type !== 'roadmap') {
      throw new Error('Expected roadmap view');
    }
    expect(view.projectId).toBe('pipeline-dashboard');
    expect(view.breadcrumbs[1]).toEqual({
      id: 'pipeline-dashboard',
      label: 'Pipeline Dashboard',
    });
    expect(view.breadcrumbs[2]).toEqual({
      id: 'pipeline-dashboard:roadmap',
      label: 'Roadmap',
    });
  });
});
