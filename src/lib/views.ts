import { PROJECT_COLUMNS, ROADMAP_COLUMNS, type ColumnDefinition } from './schema';

export type ViewContext =
  | {
      breadcrumbs: Array<{ id: string; label: string }>;
      columns: ColumnDefinition[];
      type: 'projects';
    }
  | {
      breadcrumbs: Array<{ id: string; label: string }>;
      columns: ColumnDefinition[];
      type: 'roadmap';
      projectId: string;
    };

export function defaultView(): ViewContext {
  return {
    breadcrumbs: [{ id: 'root', label: 'Dashboard' }],
    columns: PROJECT_COLUMNS,
    type: 'projects',
  };
}

export function projectRoadmapView(projectId: string, projectTitle: string): ViewContext {
  return {
    breadcrumbs: [
      { id: 'root', label: 'Dashboard' },
      { id: projectId, label: projectTitle },
    ],
    columns: ROADMAP_COLUMNS,
    type: 'roadmap',
    projectId,
  };
}
