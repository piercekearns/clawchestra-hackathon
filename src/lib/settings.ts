export type UpdateMode = 'none' | 'source-rebuild';

export type OpenClawContextPolicy = 'selected-project-first' | 'workspace-default';

export interface TrustedPathApproval {
  approvedPath: string;
  approvedAt: string;
  approvedBy: string;
  expiresAt: string;
  operations: Array<'openclaw-read' | 'openclaw-mutate' | 'catalog-mutate' | 'source-rebuild'>;
}

export interface DashboardSettings {
  settingsVersion: number;
  migrationVersion: number;
  catalogRoot: string;
  workspaceRoots: string[];
  openclawWorkspacePath: string | null;
  appSourcePath: string | null;
  updateMode: UpdateMode;
  openclawContextPolicy: OpenClawContextPolicy;
  approvedExternalPaths: TrustedPathApproval[];
}
