export type DashboardError =
  | { type: 'gateway_down'; message: string }
  | { type: 'parse_failure'; file: string; error: string }
  | { type: 'save_failure'; file: string; error: string }
  | { type: 'file_not_found'; file: string }
  | { type: 'repo_status_missing'; localPath: string; statusFile: string };
