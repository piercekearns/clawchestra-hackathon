export type UpdateMode = 'none' | 'source-rebuild';

export type OpenClawContextPolicy = 'selected-project-first' | 'workspace-default';

export interface DashboardSettings {
  settingsVersion: number;
  migrationVersion: number;
  scanPaths: string[];
  openclawWorkspacePath: string | null;
  appSourcePath: string | null;
  updateMode: UpdateMode;
  openclawContextPolicy: OpenClawContextPolicy;
}
