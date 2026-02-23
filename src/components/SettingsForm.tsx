import { useEffect, useState } from 'react';
import { ChevronDown, ClipboardCopy, Copy, Plus, Trash2 } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import type {
  DashboardSettings,
  OpenClawContextPolicy,
  SyncMode,
  UpdateMode,
} from '../lib/settings';
import { exportDebugInfo } from '../lib/tauri';

interface SettingsFormProps {
  active: boolean;
  settings: DashboardSettings | null;
  onSave: (settings: DashboardSettings) => Promise<void>;
  onCancel?: () => void;
  onSaved?: () => void;
}

export function SettingsForm({
  active,
  settings,
  onSave,
  onCancel,
  onSaved,
}: SettingsFormProps) {
  const [scanPaths, setScanPaths] = useState<string[]>(['']);
  const [openclawWorkspacePath, setOpenclawWorkspacePath] = useState('');
  const [appSourcePath, setAppSourcePath] = useState('');
  const [updateMode, setUpdateMode] = useState<UpdateMode>('source-rebuild');
  const [openclawContextPolicy, setOpenclawContextPolicy] =
    useState<OpenClawContextPolicy>('selected-project-first');
  const [syncMode, setSyncMode] = useState<SyncMode>('Local');
  const [remoteUrl, setRemoteUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [debugCopied, setDebugCopied] = useState(false);

  useEffect(() => {
    if (!active) return;
    if (!settings) {
      setScanPaths(['']);
      setOpenclawWorkspacePath('');
      setAppSourcePath('');
      setUpdateMode('source-rebuild');
      setOpenclawContextPolicy('selected-project-first');
      setSyncMode('Local');
      setRemoteUrl('');
      return;
    }

    setScanPaths(settings.scanPaths.length > 0 ? [...settings.scanPaths] : ['']);
    setOpenclawWorkspacePath(settings.openclawWorkspacePath ?? '');
    setAppSourcePath(settings.appSourcePath ?? '');
    setUpdateMode(settings.updateMode);
    setOpenclawContextPolicy(settings.openclawContextPolicy);
    setSyncMode(settings.openclawSyncMode);
    setRemoteUrl(settings.openclawRemoteUrl ?? '');
  }, [active, settings]);

  const validScanPaths = scanPaths.map((p) => p.trim()).filter(Boolean);

  return (
    <>
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

      {/* Sync Configuration (Phase 6.7) */}
      <div className={`mt-4 border-t border-neutral-200 pt-4 dark:border-neutral-700 ${!settings ? 'opacity-60' : ''}`}>
        <h3 className="mb-3 text-sm font-medium">Sync</h3>
        <div className="grid gap-3">
          <div className="grid gap-3 md:grid-cols-2">
            <label className="grid gap-1 text-sm">
              <span>Sync Mode</span>
              <div className="relative">
                <select
                  value={syncMode}
                  onChange={(event) => setSyncMode(event.target.value as SyncMode)}
                  className="h-10 w-full appearance-none rounded-lg border border-neutral-300 bg-neutral-50 px-3 pr-9 text-sm text-neutral-800 outline-none transition-colors hover:border-neutral-400 focus:border-revival-accent-400 focus:ring-2 focus:ring-revival-accent-400/40 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:border-neutral-500"
                >
                  <option value="Local">Local</option>
                  <option value="Remote">Remote</option>
                  <option value="Disabled">Disabled</option>
                </select>
                <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500" />
              </div>
              <span className="text-xs text-neutral-500 dark:text-neutral-400">
                Local: same machine. Remote: sync via HTTP endpoint.
              </span>
            </label>

            {syncMode === 'Remote' && (
              <label className="grid gap-1 text-sm">
                <span>Remote URL</span>
                <Input
                  value={remoteUrl}
                  onChange={(event) => setRemoteUrl(event.target.value)}
                  placeholder="http://192.168.1.x:18789"
                />
              </label>
            )}
          </div>

          {/* Advanced section */}
          {settings?.clientUuid && (
            <div className="grid gap-1 text-sm">
              <span className="text-neutral-500 dark:text-neutral-400">Client UUID</span>
              <div className="flex items-center gap-2">
                <code className="rounded bg-neutral-100 px-2 py-1 text-xs dark:bg-neutral-800">
                  {settings.clientUuid}
                </code>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 px-2"
                  onClick={() => {
                    void navigator.clipboard.writeText(settings.clientUuid ?? '');
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  }}
                >
                  <Copy className="mr-1 h-3 w-3" />
                  {copied ? 'Copied' : 'Copy'}
                </Button>
              </div>
            </div>
          )}

          <div className="grid gap-1 text-sm">
            <span className="text-neutral-500 dark:text-neutral-400">Extension</span>
            <span className="text-xs">Always installed on launch (auto-updated)</span>
          </div>

          <div className="grid gap-1 text-sm">
            <span className="text-neutral-500 dark:text-neutral-400">Debug</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-fit"
              onClick={async () => {
                try {
                  const info = await exportDebugInfo();
                  await navigator.clipboard.writeText(info);
                  setDebugCopied(true);
                  setTimeout(() => setDebugCopied(false), 1500);
                } catch {
                  // Silently fail — clipboard may not be available
                }
              }}
            >
              <ClipboardCopy className="mr-1 h-3 w-3" />
              {debugCopied ? 'Copied' : 'Copy debug info'}
            </Button>
          </div>
        </div>
      </div>

      <div className="mt-5 flex justify-end gap-2">
        {onCancel && (
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        )}
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
                openclawSyncMode: syncMode,
                openclawRemoteUrl: remoteUrl.trim() || null,
              });
              onSaved?.();
            } finally {
              setSaving(false);
            }
          }}
        >
          {saving ? 'Saving...' : 'Save Settings'}
        </Button>
      </div>
    </>
  );
}
