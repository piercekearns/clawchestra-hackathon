import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ClipboardCopy, Copy, Plus, Trash2 } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import type {
  DashboardSettings,
  OpenClawContextPolicy,
  SyncMode,
  UpdateMode,
} from '../lib/settings';
import {
  clearOpenclawBearerToken,
  exportDebugInfo,
  setOpenclawBearerToken,
} from '../lib/tauri';

interface SettingsFormProps {
  active: boolean;
  settings: DashboardSettings | null;
  onSave: (settings: DashboardSettings) => Promise<void>;
  onCancel?: () => void;
  onSaved?: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  saveNudge?: boolean;
  onNotify?: (kind: 'success' | 'error', message: string) => void;
}

export function SettingsForm({
  active,
  settings,
  onSave,
  onCancel,
  onSaved,
  onDirtyChange,
  saveNudge,
  onNotify,
}: SettingsFormProps) {
  const [scanPaths, setScanPaths] = useState<string[]>(['']);
  const [openclawWorkspacePath, setOpenclawWorkspacePath] = useState('');
  const [appSourcePath, setAppSourcePath] = useState('');
  const [updateMode, setUpdateMode] = useState<UpdateMode>('source-rebuild');
  const [openclawContextPolicy, setOpenclawContextPolicy] =
    useState<OpenClawContextPolicy>('selected-project-first');
  const [syncMode, setSyncMode] = useState<SyncMode>('Local');
  const [remoteUrl, setRemoteUrl] = useState('');
  const [syncIntervalMs, setSyncIntervalMs] = useState(2000);
  const [remoteBearerToken, setRemoteBearerToken] = useState('');
  const [clearRemoteToken, setClearRemoteToken] = useState(false);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [debugCopied, setDebugCopied] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const baselineRef = useRef<{
    scanPaths: string[];
    openclawWorkspacePath: string;
    appSourcePath: string;
    updateMode: UpdateMode;
    openclawContextPolicy: OpenClawContextPolicy;
    syncMode: SyncMode;
    remoteUrl: string;
    syncIntervalMs: number;
    remoteBearerToken: string;
    clearRemoteToken: boolean;
  } | null>(null);
  const saveButtonRef = useRef<HTMLButtonElement | null>(null);

  const buildSnapshot = useMemo(() => {
    return (values: {
      scanPaths: string[];
      openclawWorkspacePath: string;
      appSourcePath: string;
      updateMode: UpdateMode;
      openclawContextPolicy: OpenClawContextPolicy;
      syncMode: SyncMode;
      remoteUrl: string;
      syncIntervalMs: number;
      remoteBearerToken: string;
      clearRemoteToken: boolean;
    }) => ({
      scanPaths: values.scanPaths.map((p) => p.trim()),
      openclawWorkspacePath: values.openclawWorkspacePath.trim(),
      appSourcePath: values.appSourcePath.trim(),
      updateMode: values.updateMode,
      openclawContextPolicy: values.openclawContextPolicy,
      syncMode: values.syncMode,
      remoteUrl: values.remoteUrl.trim(),
      syncIntervalMs: Math.min(60_000, Math.max(1_000, Math.trunc(values.syncIntervalMs))),
      remoteBearerToken: values.remoteBearerToken.trim(),
      clearRemoteToken: values.clearRemoteToken,
    });
  }, []);

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
      setSyncIntervalMs(2000);
      baselineRef.current = buildSnapshot({
        scanPaths: [''],
        openclawWorkspacePath: '',
        appSourcePath: '',
        updateMode: 'source-rebuild',
        openclawContextPolicy: 'selected-project-first',
        syncMode: 'Local',
        remoteUrl: '',
        syncIntervalMs: 2000,
        remoteBearerToken: '',
        clearRemoteToken: false,
      });
      setIsDirty(false);
      onDirtyChange?.(false);
      return;
    }

    const nextScanPaths = settings.scanPaths.length > 0 ? [...settings.scanPaths] : [''];
    setScanPaths(nextScanPaths);
    setOpenclawWorkspacePath(settings.openclawWorkspacePath ?? '');
    setAppSourcePath(settings.appSourcePath ?? '');
    setUpdateMode(settings.updateMode);
    setOpenclawContextPolicy(settings.openclawContextPolicy);
    setSyncMode(settings.openclawSyncMode);
    setRemoteUrl(settings.openclawRemoteUrl ?? '');
    setSyncIntervalMs(settings.openclawSyncIntervalMs);
    setRemoteBearerToken('');
    setClearRemoteToken(false);
    baselineRef.current = buildSnapshot({
      scanPaths: nextScanPaths,
      openclawWorkspacePath: settings.openclawWorkspacePath ?? '',
      appSourcePath: settings.appSourcePath ?? '',
      updateMode: settings.updateMode,
      openclawContextPolicy: settings.openclawContextPolicy,
      syncMode: settings.openclawSyncMode,
      remoteUrl: settings.openclawRemoteUrl ?? '',
      syncIntervalMs: settings.openclawSyncIntervalMs,
      remoteBearerToken: '',
      clearRemoteToken: false,
    });
    setIsDirty(false);
    onDirtyChange?.(false);
  }, [active, buildSnapshot, onDirtyChange, settings]);

  useEffect(() => {
    if (!active) return;
    const baseline = baselineRef.current;
    if (!baseline) return;
    const current = buildSnapshot({
      scanPaths,
      openclawWorkspacePath,
      appSourcePath,
      updateMode,
      openclawContextPolicy,
      syncMode,
      remoteUrl,
      syncIntervalMs,
      remoteBearerToken,
      clearRemoteToken,
    });
    const dirty = JSON.stringify(baseline) !== JSON.stringify(current);
    if (dirty !== isDirty) {
      setIsDirty(dirty);
      onDirtyChange?.(dirty);
    }
  }, [
    active,
    appSourcePath,
    buildSnapshot,
    isDirty,
    onDirtyChange,
    openclawContextPolicy,
    openclawWorkspacePath,
    clearRemoteToken,
    remoteUrl,
    remoteBearerToken,
    scanPaths,
    syncIntervalMs,
    syncMode,
    updateMode,
  ]);

  useEffect(() => {
    if (!saveNudge || !isDirty) return;
    if (saveButtonRef.current) {
      saveButtonRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [isDirty, saveNudge]);

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

        <div className="grid gap-3">
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

        <div className="grid gap-3">
          <label className="grid gap-1 text-sm">
            <span>Update Mode</span>
            <SettingsSelect
              value={updateMode}
              onChange={(value) => setUpdateMode(value as UpdateMode)}
              options={[
                { value: 'none', label: 'none' },
                { value: 'source-rebuild', label: 'source-rebuild' },
              ]}
            />
          </label>

          <label className="grid gap-1 text-sm">
            <span>Chat Context Policy</span>
            <SettingsSelect
              value={openclawContextPolicy}
              onChange={(value) => setOpenclawContextPolicy(value as OpenClawContextPolicy)}
              options={[
                { value: 'selected-project-first', label: 'selected-project-first' },
                { value: 'workspace-default', label: 'workspace-default' },
              ]}
            />
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
          <div className="grid gap-3">
            <label className="grid gap-1 text-sm">
              <span>Sync Mode</span>
              <SettingsSelect
                value={syncMode}
                onChange={(value) => setSyncMode(value as SyncMode)}
                options={[
                  { value: 'Local', label: 'Local' },
                  { value: 'Remote', label: 'Remote' },
                  { value: 'Disabled', label: 'Disabled' },
                ]}
              />
              <span className="text-xs text-neutral-500 dark:text-neutral-400">
                Local: same machine. Remote: sync via HTTP endpoint.
              </span>
            </label>

            {syncMode === 'Remote' && (
              <>
                <label className="grid gap-1 text-sm">
                  <span>Remote URL</span>
                  <Input
                    value={remoteUrl}
                    onChange={(event) => setRemoteUrl(event.target.value)}
                    placeholder="http://192.168.1.x:18789"
                  />
                </label>
                <label className="grid gap-1 text-sm">
                  <span>Bearer Token (keychain)</span>
                  <Input
                    type="password"
                    value={remoteBearerToken}
                    onChange={(event) => {
                      setRemoteBearerToken(event.target.value);
                      if (event.target.value.trim().length > 0) {
                        setClearRemoteToken(false);
                      }
                    }}
                    placeholder="Leave blank to keep existing token"
                  />
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-neutral-500 dark:text-neutral-400">
                      Stored in OS keychain. Enter a new token to replace.
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 px-2"
                      onClick={() => {
                        setRemoteBearerToken('');
                        setClearRemoteToken(true);
                      }}
                    >
                      Clear token
                    </Button>
                  </div>
                </label>
              </>
            )}

            <label className="grid gap-1 text-sm">
              <span>Sync Interval (ms)</span>
              <Input
                type="number"
                min={1000}
                max={60000}
                step={500}
                value={String(syncIntervalMs)}
                onChange={(event) => {
                  const parsed = Number.parseInt(event.target.value, 10);
                  if (Number.isNaN(parsed)) {
                    setSyncIntervalMs(2000);
                  } else {
                    setSyncIntervalMs(parsed);
                  }
                }}
              />
              <span className="text-xs text-neutral-500 dark:text-neutral-400">
                Applies to local continuous sync polling. Allowed range: 1000-60000ms.
              </span>
            </label>
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
                  let copiedOk = false;
                  try {
                    await navigator.clipboard.writeText(info);
                    copiedOk = true;
                  } catch {
                    // Fallback: legacy clipboard path
                    const textarea = document.createElement('textarea');
                    textarea.value = info;
                    textarea.style.position = 'fixed';
                    textarea.style.opacity = '0';
                    document.body.appendChild(textarea);
                    textarea.focus();
                    textarea.select();
                    try {
                      copiedOk = document.execCommand('copy');
                    } finally {
                      document.body.removeChild(textarea);
                    }
                  }

                  if (!copiedOk) {
                    throw new Error('Clipboard write failed');
                  }

                  setDebugCopied(true);
                  onNotify?.('success', 'Debug info copied');
                  setTimeout(() => setDebugCopied(false), 1500);
                } catch (error) {
                  const message = error instanceof Error ? error.message : 'Failed to copy debug info';
                  onNotify?.('error', message);
                }
              }}
            >
              <ClipboardCopy className="mr-1 h-3 w-3" />
              {debugCopied ? 'Copied' : 'Copy debug info'}
            </Button>
          </div>
        </div>
      </div>

      <div className="mt-5 flex items-center justify-end gap-2">
        {saveNudge && isDirty ? (
          <span className="mr-auto text-xs text-neutral-500 dark:text-neutral-400">
            Save changes to return
          </span>
        ) : null}
        {onCancel && (
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        )}
        {isDirty && (
          <Button
            ref={saveButtonRef}
            type="button"
            disabled={!settings || saving || validScanPaths.length === 0}
            className={saveNudge ? 'ring-2 ring-revival-accent-400/40' : ''}
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
                  openclawSyncIntervalMs: syncIntervalMs,
                });

                if (syncMode === 'Remote') {
                  if (clearRemoteToken) {
                    await clearOpenclawBearerToken();
                  } else if (remoteBearerToken.trim().length > 0) {
                    await setOpenclawBearerToken(remoteBearerToken.trim());
                  }
                }

                baselineRef.current = buildSnapshot({
                  scanPaths: validScanPaths,
                  openclawWorkspacePath,
                  appSourcePath,
                  updateMode,
                  openclawContextPolicy,
                  syncMode,
                  remoteUrl,
                  syncIntervalMs,
                  remoteBearerToken: '',
                  clearRemoteToken: false,
                });
                setRemoteBearerToken('');
                setClearRemoteToken(false);
                setIsDirty(false);
                onDirtyChange?.(false);
                onSaved?.();
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? 'Saving...' : 'Save changes'}
          </Button>
        )}
      </div>
    </>
  );
}


type SelectOption = { value: string; label: string };

function SettingsSelect({
  value,
  onChange,
  options,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const selected = options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const handleClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey, true);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey, true);
    };
  }, [open]);

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
        className={`flex h-10 w-full items-center justify-between rounded-lg border border-neutral-300 bg-neutral-50 px-3 text-sm text-neutral-800 transition-colors hover:border-neutral-400 focus-visible:border-revival-accent-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-revival-accent-400/40 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:border-neutral-500 ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
      >
        <span className="truncate">{selected?.label ?? value}</span>
        <ChevronDown
          className={`h-4 w-4 text-neutral-500 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div
          ref={menuRef}
          className="absolute z-30 mt-1 w-full rounded-lg border border-neutral-200 bg-neutral-0 p-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
          onClick={() => setOpen(false)}
        >
          {options.map((option) => {
            const isSelected = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                className={`flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-sm transition-colors ${isSelected ? 'bg-neutral-200 text-neutral-900 dark:bg-neutral-700 dark:text-neutral-100' : 'text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800'}`}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
              >
                <span className="truncate">{option.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
