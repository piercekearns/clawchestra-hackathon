export type UpdateMode = 'none' | 'source-rebuild';

export type OpenClawContextPolicy = 'selected-project-first' | 'workspace-default';

export type SyncMode = 'Local' | 'Remote' | 'Disabled' | 'Unknown';
export type OpenClawChatTransportMode = 'Local' | 'Remote' | 'Disabled' | 'Unknown';

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
  /** How Clawchestra reaches the OpenClaw chat gateway */
  openclawChatTransportMode: OpenClawChatTransportMode;
  /** Explicit remote websocket URL when chat transport mode is Remote */
  openclawChatWsUrl: string | null;
  /** Optional explicit session key override for chat transport */
  openclawChatSessionKey: string | null;
  /** Chat transport token, stored in the OS keychain */
  openclawChatToken: string | null;
  /** How Clawchestra syncs with OpenClaw */
  openclawSyncMode: SyncMode;
  /** URL of the remote OpenClaw instance (when sync_mode is Remote) */
  openclawRemoteUrl: string | null;
  /** Bearer token for authenticating with the remote OpenClaw instance */
  openclawBearerToken: string | null;
  /** Continuous sync polling interval (milliseconds, clamped in backend) */
  openclawSyncIntervalMs: number;
  /** Size of the per-project state history buffer (default: 20) */
  stateHistoryBufferSize: number;
}
