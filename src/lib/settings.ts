export type UpdateMode = 'none' | 'source-rebuild';

export type OpenClawContextPolicy = 'selected-project-first' | 'workspace-default';

export type SyncMode = 'Local' | 'Remote' | 'Disabled' | 'Unknown';

export interface DashboardSettings {
  settingsVersion: number;
  migrationVersion: number;
  scanPaths: string[];
  openclawWorkspacePath: string | null;
  appSourcePath: string | null;
  updateMode: UpdateMode;
  openclawContextPolicy: OpenClawContextPolicy;
  /** Unique client identifier (UUID v4), generated on first launch */
  clientUuid: string | null;
  /** How Clawchestra syncs with OpenClaw */
  openclawSyncMode: SyncMode;
  /** URL of the remote OpenClaw instance (when sync_mode is Remote) */
  openclawRemoteUrl: string | null;
  /** Bearer token for authenticating with the remote OpenClaw instance */
  openclawBearerToken: string | null;
  /** Size of the per-project state history buffer (default: 20) */
  stateHistoryBufferSize: number;
}
