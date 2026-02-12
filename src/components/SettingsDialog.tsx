import { useEffect, useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import type {
  DashboardSettings,
  OpenClawContextPolicy,
  UpdateMode,
} from '../lib/settings';
import type { MigrationReport } from '../lib/tauri';

interface SettingsDialogProps {
  open: boolean;
  settings: DashboardSettings | null;
  onClose: () => void;
  onSave: (settings: DashboardSettings) => Promise<void>;
  onRunMigration: () => Promise<MigrationReport>;
}

export function SettingsDialog({ open, settings, onClose, onSave, onRunMigration }: SettingsDialogProps) {
  const [catalogRoot, setCatalogRoot] = useState('');
  const [workspaceRootsText, setWorkspaceRootsText] = useState('');
  const [openclawWorkspacePath, setOpenclawWorkspacePath] = useState('');
  const [appSourcePath, setAppSourcePath] = useState('');
  const [updateMode, setUpdateMode] = useState<UpdateMode>('source-rebuild');
  const [openclawContextPolicy, setOpenclawContextPolicy] =
    useState<OpenClawContextPolicy>('selected-project-first');
  const [saving, setSaving] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const [migrationSummary, setMigrationSummary] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !settings) return;

    setCatalogRoot(settings.catalogRoot);
    setWorkspaceRootsText(settings.workspaceRoots.join('\n'));
    setOpenclawWorkspacePath(settings.openclawWorkspacePath ?? '');
    setAppSourcePath(settings.appSourcePath ?? '');
    setUpdateMode(settings.updateMode);
    setOpenclawContextPolicy(settings.openclawContextPolicy);
    setMigrationSummary(null);
  }, [open, settings]);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  const workspaceRoots = useMemo(
    () =>
      workspaceRootsText
        .split(/\n|,/)
        .map((entry) => entry.trim())
        .filter(Boolean),
    [workspaceRootsText],
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-2xl rounded-2xl border border-neutral-200 bg-neutral-0 p-5 shadow-xl dark:border-neutral-700 dark:bg-neutral-900">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Dashboard Settings</h2>
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>

        {!settings && (
          <div className="mb-4 rounded-lg border border-status-danger/40 bg-status-danger/10 px-3 py-2 text-sm text-status-danger">
            Settings are unavailable right now. Close this dialog and reload the app.
          </div>
        )}

        <div className={`grid gap-3 ${!settings ? 'opacity-60' : ''}`}>
          <label className="grid gap-1 text-sm">
            <span>Catalog Root</span>
            <Input
              value={catalogRoot}
              onChange={(event) => setCatalogRoot(event.target.value)}
              placeholder="~/clawdbot-sandbox/projects"
            />
          </label>

          <label className="grid gap-1 text-sm">
            <span>Workspace Roots (one per line)</span>
            <textarea
              value={workspaceRootsText}
              onChange={(event) => setWorkspaceRootsText(event.target.value)}
              className="min-h-28 w-full rounded-lg border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm text-neutral-800 outline-none transition-colors hover:border-neutral-400 focus:border-revival-accent-400 focus:ring-2 focus:ring-revival-accent-400/40 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:border-neutral-500"
              placeholder="~/projects&#10;~/clawdbot-sandbox/projects"
            />
          </label>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="grid gap-1 text-sm">
              <span>OpenClaw Workspace Path (optional)</span>
              <Input
                value={openclawWorkspacePath}
                onChange={(event) => setOpenclawWorkspacePath(event.target.value)}
                placeholder="~/clawdbot-sandbox"
              />
            </label>

            <label className="grid gap-1 text-sm">
              <span>App Source Path (optional)</span>
              <Input
                value={appSourcePath}
                onChange={(event) => setAppSourcePath(event.target.value)}
                placeholder="~/repos/pipeline-dashboard"
              />
            </label>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="grid gap-1 text-sm">
              <span>Update Mode</span>
              <div className="relative">
                <select
                  value={updateMode}
                  onChange={(event) => setUpdateMode(event.target.value as UpdateMode)}
                  className="h-10 w-full appearance-none rounded-lg border border-neutral-300 bg-neutral-50 px-3 pr-9 text-sm text-neutral-800 outline-none transition-colors hover:border-neutral-400 focus:border-revival-accent-400 focus:ring-2 focus:ring-revival-accent-400/40 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:border-neutral-500"
                >
                  <option value="none">none</option>
                  <option value="source-rebuild">source-rebuild</option>
                </select>
                <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500" />
              </div>
            </label>

            <label className="grid gap-1 text-sm">
              <span>OpenClaw Context Policy</span>
              <div className="relative">
                <select
                  value={openclawContextPolicy}
                  onChange={(event) =>
                    setOpenclawContextPolicy(event.target.value as OpenClawContextPolicy)
                  }
                  className="h-10 w-full appearance-none rounded-lg border border-neutral-300 bg-neutral-50 px-3 pr-9 text-sm text-neutral-800 outline-none transition-colors hover:border-neutral-400 focus:border-revival-accent-400 focus:ring-2 focus:ring-revival-accent-400/40 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:border-neutral-500"
                >
                  <option value="selected-project-first">selected-project-first</option>
                  <option value="workspace-default">workspace-default</option>
                </select>
                <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500" />
              </div>
            </label>
          </div>

          <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-sm dark:border-neutral-700 dark:bg-neutral-950/40">
            <p className="font-semibold">Architecture V2 Migration</p>
            <p className="mt-1 text-xs text-neutral-500">
              Moves legacy catalog markdown entries into <code>catalogRoot/projects</code> and writes a migration state report.
            </p>
            <div className="mt-2 flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!settings || migrating}
                onClick={async () => {
                  setMigrating(true);
                  setMigrationSummary(null);
                  try {
                    const report = await onRunMigration();
                    setMigrationSummary(
                      `Moved ${report.movedEntries.length} entries, skipped ${report.skippedEntries.length}.`,
                    );
                  } catch (error) {
                    setMigrationSummary(
                      error instanceof Error ? error.message : 'Migration failed',
                    );
                  } finally {
                    setMigrating(false);
                  }
                }}
              >
                {migrating ? 'Running migration...' : 'Run V2 Migration'}
              </Button>
              {migrationSummary && <span className="text-xs text-neutral-500">{migrationSummary}</span>}
            </div>
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!settings || saving || !catalogRoot.trim() || workspaceRoots.length === 0}
            onClick={async () => {
              if (!settings) return;
              setSaving(true);
              try {
                await onSave({
                  ...settings,
                  catalogRoot: catalogRoot.trim(),
                  workspaceRoots,
                  openclawWorkspacePath: openclawWorkspacePath.trim() || null,
                  appSourcePath: appSourcePath.trim() || null,
                  updateMode,
                  openclawContextPolicy,
                });
                onClose();
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? 'Saving...' : 'Save Settings'}
          </Button>
        </div>
      </div>
    </div>
  );
}
