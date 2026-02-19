import { useEffect, useState } from 'react';
import { ChevronDown, Plus, Trash2 } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import type {
  DashboardSettings,
  OpenClawContextPolicy,
  UpdateMode,
} from '../lib/settings';

interface SettingsDialogProps {
  open: boolean;
  settings: DashboardSettings | null;
  onClose: () => void;
  onSave: (settings: DashboardSettings) => Promise<void>;
}

export function SettingsDialog({ open, settings, onClose, onSave }: SettingsDialogProps) {
  const [scanPaths, setScanPaths] = useState<string[]>([]);
  const [openclawWorkspacePath, setOpenclawWorkspacePath] = useState('');
  const [appSourcePath, setAppSourcePath] = useState('');
  const [updateMode, setUpdateMode] = useState<UpdateMode>('source-rebuild');
  const [openclawContextPolicy, setOpenclawContextPolicy] =
    useState<OpenClawContextPolicy>('selected-project-first');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !settings) return;

    setScanPaths(settings.scanPaths.length > 0 ? [...settings.scanPaths] : ['']);
    setOpenclawWorkspacePath(settings.openclawWorkspacePath ?? '');
    setAppSourcePath(settings.appSourcePath ?? '');
    setUpdateMode(settings.updateMode);
    setOpenclawContextPolicy(settings.openclawContextPolicy);
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

  const validScanPaths = scanPaths.map((p) => p.trim()).filter(Boolean);

  if (!open) return null;

  return (
    <div className="fixed inset-0 top-[46px] z-40 flex items-center justify-center bg-neutral-950/40 p-4 backdrop-blur-sm">
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
          <div className="grid gap-1 text-sm">
            <span>Scan Paths</span>
            <div className="grid gap-2">
              {scanPaths.map((path, index) => (
                <div key={index} className="flex gap-2">
                  <Input
                    value={path}
                    onChange={(event) => {
                      const next = [...scanPaths];
                      next[index] = event.target.value;
                      setScanPaths(next);
                    }}
                    placeholder="~/repos"
                  />
                  {scanPaths.length > 1 && (
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-10 w-10 shrink-0"
                      onClick={() => setScanPaths(scanPaths.filter((_, i) => i !== index))}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-fit"
                onClick={() => setScanPaths([...scanPaths, ''])}
              >
                <Plus className="mr-1 h-3 w-3" />
                Add path
              </Button>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="grid gap-1 text-sm">
              <span>Chat Context Workspace Path (optional)</span>
              <Input
                value={openclawWorkspacePath}
                onChange={(event) => setOpenclawWorkspacePath(event.target.value)}
                placeholder="~/clawdbot-sandbox"
              />
              <span className="text-xs text-neutral-500 dark:text-neutral-400">
                Used for chat context injection. Gateway session routing still follows OpenClaw runtime config.
              </span>
            </label>

            <label className="grid gap-1 text-sm">
              <span>App Source Path (optional)</span>
              <Input
                value={appSourcePath}
                onChange={(event) => setAppSourcePath(event.target.value)}
                placeholder="~/repos/clawchestra"
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
              <span>Chat Context Policy</span>
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
              <span className="text-xs text-neutral-500 dark:text-neutral-400">
                Controls prompt context priority only (selected project vs workspace path).
              </span>
            </label>
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!settings || saving || validScanPaths.length === 0}
            onClick={async () => {
              if (!settings) return;
              setSaving(true);
              try {
                await onSave({
                  ...settings,
                  scanPaths: validScanPaths,
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
