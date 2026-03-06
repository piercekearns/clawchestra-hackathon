export type DashboardError =
  | { type: 'gateway_down'; message: string }
  | { type: 'parse_failure'; file: string; error: string }
  | { type: 'save_failure'; file: string; error: string }
  | { type: 'file_not_found'; file: string }
  | { type: 'duplicate_project_id'; id: string; paths: string[] }
  | { type: 'scan_path_missing'; path: string }
  | { type: 'scan_path_permission_denied'; path: string };
