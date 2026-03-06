import { useEffect, useMemo, useRef, useState } from 'react';
import { ClipboardCopy, Copy, Plus, Trash2 } from 'lucide-react';
import { Button } from './ui/button';
import { BrandedSelect } from './ui/branded-select';
import { Input } from './ui/input';
import type {
  DashboardSettings,
  OpenClawChatTransportMode,
  OpenClawContextPolicy,
  SyncMode,
  UpdateMode,
} from '../lib/settings';
import { checkGatewayConnection, refreshGatewayTransportConfig } from '../lib/gateway';
import { testSyncConnection, type TransportCheckResult } from '../lib/sync';
import {
  clearOpenclawBearerToken,
  clearOpenclawChatToken,
  ensureSyncIdentity,
  exportDebugInfo,
  getExtensionContent,
  getOpenClawSupportStatus,
  installOpenclawExtension,
  isTauriRuntime,
  type OpenClawSupportStatus,
  peekOpenclawBearerToken,
  resolveOpenClawGatewayConfigPreview,
  setOpenclawBearerToken,
  setOpenclawChatToken,
} from '../lib/tauri';
import { buildRemoteOpenclawInstallScript } from '../lib/openclaw-support';

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

type CheckState =
  | { kind: 'idle'; message: string }
  | { kind: 'working'; message: string }
  | { kind: 'success'; message: string }
  | { kind: 'error'; message: string };

const IDLE_CHECK_STATE: CheckState = { kind: 'idle', message: '' };

function toCheckState(result: TransportCheckResult): CheckState {
  return result.success
    ? { kind: 'success', message: result.message }
    : { kind: 'error', message: result.message };
}

function CheckStatus({ state }: { state: CheckState }) {
  if (state.kind === 'idle' || !state.message) return null;

  const colorClass =
    state.kind === 'success'
      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
      : state.kind === 'error'
        ? 'border-status-danger/40 bg-status-danger/10 text-status-danger'
        : 'border-neutral-300 bg-neutral-100 text-neutral-700 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200';

  return <div className={`rounded-lg border px-3 py-2 text-xs ${colorClass}`}>{state.message}</div>;
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
  const supportsSourceRebuildUpdate = typeof navigator !== 'undefined'
    && /mac|iphone|ipad/i.test(`${navigator.platform} ${navigator.userAgent}`);
  const [scanPaths, setScanPaths] = useState<string[]>(['']);
  const [openclawWorkspacePath, setOpenclawWorkspacePath] = useState('');
  const [appSourcePath, setAppSourcePath] = useState('');
  const [updateMode, setUpdateMode] = useState<UpdateMode>(
    supportsSourceRebuildUpdate ? 'source-rebuild' : 'none',
  );
  const [openclawContextPolicy, setOpenclawContextPolicy] =
    useState<OpenClawContextPolicy>('selected-project-first');
  const [chatTransportMode, setChatTransportMode] = useState<OpenClawChatTransportMode>('Local');
  const [chatWsUrl, setChatWsUrl] = useState('');
  const [chatSessionKey, setChatSessionKey] = useState('');
  const [chatToken, setChatToken] = useState('');
  const [clearChatToken, setClearChatToken] = useState(false);
  const [syncMode, setSyncMode] = useState<SyncMode>('Local');
  const [remoteUrl, setRemoteUrl] = useState('');
  const [syncIntervalMs, setSyncIntervalMs] = useState(2000);
  const [remoteBearerToken, setRemoteBearerToken] = useState('');
  const [clearRemoteToken, setClearRemoteToken] = useState(false);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [extensionCopied, setExtensionCopied] = useState(false);
  const [debugCopied, setDebugCopied] = useState(false);
  const [remoteInstallCopied, setRemoteInstallCopied] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [chatCheck, setChatCheck] = useState<CheckState>(IDLE_CHECK_STATE);
  const [syncCheck, setSyncCheck] = useState<CheckState>(IDLE_CHECK_STATE);
  const [openclawSupportStatus, setOpenclawSupportStatus] = useState<OpenClawSupportStatus | null>(null);
  const [supportRefreshing, setSupportRefreshing] = useState(false);
  const [extensionInstalling, setExtensionInstalling] = useState(false);
  const [systemContextWriting, setSystemContextWriting] = useState(false);
  const baselineRef = useRef<{
    scanPaths: string[];
    openclawWorkspacePath: string;
    appSourcePath: string;
    updateMode: UpdateMode;
    openclawContextPolicy: OpenClawContextPolicy;
    chatTransportMode: OpenClawChatTransportMode;
    chatWsUrl: string;
    chatSessionKey: string;
    chatToken: string;
    clearChatToken: boolean;
    syncMode: SyncMode;
    remoteUrl: string;
    syncIntervalMs: number;
    remoteBearerToken: string;
    clearRemoteToken: boolean;
  } | null>(null);
  const saveButtonRef = useRef<HTMLButtonElement | null>(null);

  const copyText = async (text: string): Promise<boolean> => {
    if (!text) return false;

    if (isTauriRuntime()) {
      try {
        const { writeText } = await import('@tauri-apps/plugin-clipboard-manager');
        await writeText(text);
        return true;
      } catch (error) {
        console.warn('[Clipboard] Tauri clipboard write failed:', error);
      }
    }

    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {
        // Fall through to legacy execCommand path.
      }
    }

    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    try {
      return document.execCommand('copy');
    } finally {
      document.body.removeChild(textarea);
    }
  };

  const buildSnapshot = useMemo(() => {
    return (values: {
      scanPaths: string[];
      openclawWorkspacePath: string;
      appSourcePath: string;
      updateMode: UpdateMode;
      openclawContextPolicy: OpenClawContextPolicy;
      chatTransportMode: OpenClawChatTransportMode;
      chatWsUrl: string;
      chatSessionKey: string;
      chatToken: string;
      clearChatToken: boolean;
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
      chatTransportMode: values.chatTransportMode,
      chatWsUrl: values.chatWsUrl.trim(),
      chatSessionKey: values.chatSessionKey.trim(),
      chatToken: values.chatToken.trim(),
      clearChatToken: values.clearChatToken,
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
      setUpdateMode(supportsSourceRebuildUpdate ? 'source-rebuild' : 'none');
      setOpenclawContextPolicy('selected-project-first');
      setChatTransportMode('Local');
      setChatWsUrl('');
      setChatSessionKey('');
      setChatToken('');
      setClearChatToken(false);
      setSyncMode('Local');
      setRemoteUrl('');
      setSyncIntervalMs(2000);
      setRemoteBearerToken('');
      setClearRemoteToken(false);
      setChatCheck(IDLE_CHECK_STATE);
      setSyncCheck(IDLE_CHECK_STATE);
      baselineRef.current = buildSnapshot({
        scanPaths: [''],
        openclawWorkspacePath: '',
        appSourcePath: '',
        updateMode: supportsSourceRebuildUpdate ? 'source-rebuild' : 'none',
        openclawContextPolicy: 'selected-project-first',
        chatTransportMode: 'Local',
        chatWsUrl: '',
        chatSessionKey: '',
        chatToken: '',
        clearChatToken: false,
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
    setChatTransportMode(settings.openclawChatTransportMode);
    setChatWsUrl(settings.openclawChatWsUrl ?? '');
    setChatSessionKey(settings.openclawChatSessionKey ?? '');
    setChatToken('');
    setClearChatToken(false);
    setSyncMode(settings.openclawSyncMode);
    setRemoteUrl(settings.openclawRemoteUrl ?? '');
    setSyncIntervalMs(settings.openclawSyncIntervalMs);
    setRemoteBearerToken('');
    setClearRemoteToken(false);
    setChatCheck(IDLE_CHECK_STATE);
    setSyncCheck(IDLE_CHECK_STATE);
    baselineRef.current = buildSnapshot({
      scanPaths: nextScanPaths,
      openclawWorkspacePath: settings.openclawWorkspacePath ?? '',
      appSourcePath: settings.appSourcePath ?? '',
      updateMode: settings.updateMode,
      openclawContextPolicy: settings.openclawContextPolicy,
      chatTransportMode: settings.openclawChatTransportMode,
      chatWsUrl: settings.openclawChatWsUrl ?? '',
      chatSessionKey: settings.openclawChatSessionKey ?? '',
      chatToken: '',
      clearChatToken: false,
      syncMode: settings.openclawSyncMode,
      remoteUrl: settings.openclawRemoteUrl ?? '',
      syncIntervalMs: settings.openclawSyncIntervalMs,
      remoteBearerToken: '',
      clearRemoteToken: false,
    });
    setIsDirty(false);
    onDirtyChange?.(false);
  }, [active, buildSnapshot, onDirtyChange, settings, supportsSourceRebuildUpdate]);

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
      chatTransportMode,
      chatWsUrl,
      chatSessionKey,
      chatToken,
      clearChatToken,
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
    chatSessionKey,
    chatToken,
    chatTransportMode,
    chatWsUrl,
    clearChatToken,
    clearRemoteToken,
    isDirty,
    onDirtyChange,
    openclawContextPolicy,
    openclawWorkspacePath,
    remoteBearerToken,
    remoteUrl,
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

  useEffect(() => {
    if (!active || !isTauriRuntime()) return;

    let cancelled = false;
    const loadSupportStatus = async () => {
      setSupportRefreshing(true);
      try {
        const status = await getOpenClawSupportStatus();
        if (!cancelled) {
          setOpenclawSupportStatus(status);
        }
      } catch {
        if (!cancelled) {
          setOpenclawSupportStatus(null);
        }
      } finally {
        if (!cancelled) {
          setSupportRefreshing(false);
        }
      }
    };

    void loadSupportStatus();

    return () => {
      cancelled = true;
    };
  }, [active, settings]);

  const validScanPaths = scanPaths.map((p) => p.trim()).filter(Boolean);

  const runChatConnectionTest = async () => {
    if (chatTransportMode === 'Disabled') {
      setChatCheck({ kind: 'success', message: 'Chat transport is disabled.' });
      return;
    }

    setChatCheck({ kind: 'working', message: 'Testing chat transport...' });
    try {
      const preview = await resolveOpenClawGatewayConfigPreview({
        mode: chatTransportMode,
        wsUrl: chatWsUrl.trim() || null,
        sessionKey: chatSessionKey.trim() || null,
        token: chatToken.trim() || null,
      });
      const success = await checkGatewayConnection({
        transport: {
          mode: 'tauri-ws',
          wsUrl: preview.wsUrl,
          token: preview.token,
          sessionKey: preview.sessionKey,
        },
      });

      setChatCheck(
        success
          ? {
              kind: 'success',
              message: `Chat transport connected via ${preview.source}.`,
            }
          : {
              kind: 'error',
              message: 'Chat transport could not connect. Check the gateway URL, token, and OpenClaw runtime.',
            },
      );
    } catch (error) {
      setChatCheck({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Chat transport test failed.',
      });
    }
  };

  const runSyncConnectionTest = async () => {
    setSyncCheck({ kind: 'working', message: 'Testing sync transport...' });
    try {
      const token = remoteBearerToken.trim() || (await peekOpenclawBearerToken()) || null;
      setSyncCheck(toCheckState(await testSyncConnection(syncMode, remoteUrl, token)));
    } catch (error) {
      setSyncCheck({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Sync transport test failed.',
      });
    }
  };

  const copyRemoteInstallCommand = async () => {
    try {
      const bearerToken = remoteBearerToken.trim() || (await peekOpenclawBearerToken()) || '';
      if (!bearerToken) {
        throw new Error('Save or enter a remote bearer token before copying the remote install command.');
      }

      const extensionContent = await getExtensionContent();
      const script = buildRemoteOpenclawInstallScript({
        bearerToken,
        extensionContent,
      });
      const copiedOk = await copyText(script);
      if (!copiedOk) {
        throw new Error('Clipboard write failed');
      }
      setRemoteInstallCopied(true);
      onNotify?.('success', 'Remote install command copied');
      setTimeout(() => setRemoteInstallCopied(false), 1500);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to copy remote install command';
      onNotify?.('error', message);
    }
  };

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
              placeholder="~/openclaw-workspace"
            />
            <span className="text-xs text-neutral-500 dark:text-neutral-400">
              Used for prompt context injection only. It does not choose the chat transport or sync endpoint.
            </span>
          </label>

          <label className="grid gap-1 text-sm">
            <span>App Source Path (optional)</span>
            <Input
              value={appSourcePath}
              onChange={(event) => setAppSourcePath(event.target.value)}
              placeholder="/path/to/clawchestra"
            />
          </label>
        </div>

        <div className="grid gap-3">
          <label className="grid gap-1 text-sm">
            <span>Update Mode</span>
            <BrandedSelect
              value={updateMode}
              onChange={(value) => setUpdateMode(value as UpdateMode)}
              options={[
                { value: 'none', label: 'none' },
                ...(supportsSourceRebuildUpdate
                  ? [{ value: 'source-rebuild', label: 'source-rebuild' }]
                  : []),
              ]}
            />
            <span className="text-xs text-neutral-500 dark:text-neutral-400">
              <code>source-rebuild</code> is the current developer-only update path and is only supported for macOS source installs right now. Packaged release installs will use GitHub Releases instead once the packaged updater exists.
            </span>
          </label>

          <label className="grid gap-1 text-sm">
            <span>Chat Context Policy</span>
            <BrandedSelect
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

      <div className={`mt-4 border-t border-neutral-200 pt-4 dark:border-neutral-700 ${!settings ? 'opacity-60' : ''}`}>
        <h3 className="mb-3 text-sm font-medium">Chat Transport</h3>
        <div className="grid gap-3">
          <label className="grid gap-1 text-sm">
            <span>Transport Mode</span>
            <BrandedSelect
              value={chatTransportMode}
              onChange={(value) => {
                setChatTransportMode(value as OpenClawChatTransportMode);
                setChatCheck(IDLE_CHECK_STATE);
              }}
              options={[
                { value: 'Local', label: 'Local' },
                { value: 'Remote', label: 'Remote' },
                { value: 'Disabled', label: 'Disabled' },
              ]}
            />
            <span className="text-xs text-neutral-500 dark:text-neutral-400">
              Local: resolve from this machine&apos;s OpenClaw runtime. Remote: use an explicit websocket endpoint.
            </span>
          </label>

          {chatTransportMode === 'Remote' && (
            <>
              <label className="grid gap-1 text-sm">
                <span>WebSocket URL</span>
                <Input
                  value={chatWsUrl}
                  onChange={(event) => setChatWsUrl(event.target.value)}
                  placeholder="ws://192.168.1.x:18789"
                />
              </label>

              <label className="grid gap-1 text-sm">
                <span>Session Key (optional)</span>
                <Input
                  value={chatSessionKey}
                  onChange={(event) => setChatSessionKey(event.target.value)}
                  placeholder="agent:main:clawchestra"
                />
                <span className="text-xs text-neutral-500 dark:text-neutral-400">
                  Leave blank to use Clawchestra&apos;s default session key.
                </span>
              </label>

              <label className="grid gap-1 text-sm">
                <span>Chat Token (keychain)</span>
                <Input
                  type="password"
                  value={chatToken}
                  onChange={(event) => {
                    setChatToken(event.target.value);
                    if (event.target.value.trim().length > 0) {
                      setClearChatToken(false);
                    }
                  }}
                  placeholder="Leave blank to keep existing token"
                />
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-neutral-500 dark:text-neutral-400">
                    Stored in the OS keychain. Enter a new token to replace the saved value.
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 px-2"
                    onClick={() => {
                      setChatToken('');
                      setClearChatToken(true);
                    }}
                  >
                    Clear token
                  </Button>
                </div>
              </label>
            </>
          )}

          {chatTransportMode === 'Local' && (
            <label className="grid gap-1 text-sm">
              <span>Session Key (optional)</span>
              <Input
                value={chatSessionKey}
                onChange={(event) => setChatSessionKey(event.target.value)}
                placeholder="agent:main:clawchestra"
              />
              <span className="text-xs text-neutral-500 dark:text-neutral-400">
                Local mode still lets you override the session key while the websocket URL/token come from <code>~/.openclaw/openclaw.json</code>.
              </span>
            </label>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!settings || saving || chatCheck.kind === 'working'}
              onClick={() => void runChatConnectionTest()}
            >
              {chatCheck.kind === 'working' ? 'Testing chat...' : 'Test chat connection'}
            </Button>
            <span className="text-xs text-neutral-500 dark:text-neutral-400">
              Tests the current form values, not just the last saved settings.
            </span>
          </div>

          <CheckStatus state={chatCheck} />
        </div>
      </div>

      <div className={`mt-4 border-t border-neutral-200 pt-4 dark:border-neutral-700 ${!settings ? 'opacity-60' : ''}`}>
        <h3 className="mb-3 text-sm font-medium">Sync</h3>
        <div className="grid gap-3">
          <label className="grid gap-1 text-sm">
            <span>Sync Mode</span>
            <BrandedSelect
              value={syncMode}
              onChange={(value) => {
                setSyncMode(value as SyncMode);
                setSyncCheck(IDLE_CHECK_STATE);
              }}
              options={[
                { value: 'Local', label: 'Local' },
                { value: 'Remote', label: 'Remote' },
                { value: 'Disabled', label: 'Disabled' },
              ]}
            />
            <span className="text-xs text-neutral-500 dark:text-neutral-400">
              Local: same-machine file sync. Remote: HTTP sync against an OpenClaw endpoint.
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

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!settings || saving || syncCheck.kind === 'working'}
              onClick={() => void runSyncConnectionTest()}
            >
              {syncCheck.kind === 'working' ? 'Testing sync...' : 'Test sync connection'}
            </Button>
            <span className="text-xs text-neutral-500 dark:text-neutral-400">
              Remote mode checks the HTTP endpoint. Local mode confirms the canonical same-machine path.
            </span>
          </div>

          <CheckStatus state={syncCheck} />

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
                  onClick={async () => {
                    const ok = await copyText(settings.clientUuid ?? '');
                    if (!ok) {
                      onNotify?.('error', 'Clipboard write failed');
                      return;
                    }
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
            <div className="grid gap-2 text-xs text-neutral-500 dark:text-neutral-400">
              <span>
                Clawchestra can install the local OpenClaw extension when the runtime lives on this machine. Remote OpenClaw hosts still use the copied extension content/manual path for now.
              </span>
              {openclawSupportStatus && (
                <div className="grid gap-1 rounded-lg border border-neutral-200 px-3 py-2 dark:border-neutral-700">
                  <span>
                    OpenClaw CLI: {openclawSupportStatus.openclawCliDetected ? 'detected' : 'not detected'}
                  </span>
                  <span>
                    OpenClaw root: {openclawSupportStatus.openclawRootExists ? 'present' : 'missing'} ({openclawSupportStatus.openclawRootPath})
                  </span>
                  <span>
                    Clawchestra data dir: {openclawSupportStatus.clawchestraDataExists ? 'present' : 'not created yet'} ({openclawSupportStatus.clawchestraDataPath})
                  </span>
                  <span>
                    System context: {openclawSupportStatus.systemContextExists ? 'present' : 'missing'} ({openclawSupportStatus.systemContextPath})
                  </span>
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-fit"
                  disabled={extensionInstalling || !openclawSupportStatus?.openclawRootExists}
                  onClick={async () => {
                    if (!openclawSupportStatus?.openclawRootExists) return;
                    setExtensionInstalling(true);
                    try {
                      await installOpenclawExtension(openclawSupportStatus.openclawRootPath);
                      setOpenclawSupportStatus(await getOpenClawSupportStatus());
                      onNotify?.('success', 'OpenClaw extension installed');
                    } catch (error) {
                      const message = error instanceof Error ? error.message : 'Failed to install extension';
                      onNotify?.('error', message);
                    } finally {
                      setExtensionInstalling(false);
                    }
                  }}
                >
                  {extensionInstalling ? 'Installing...' : 'Install local extension'}
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-fit"
                  disabled={systemContextWriting}
                  onClick={async () => {
                    setSystemContextWriting(true);
                    try {
                      await ensureSyncIdentity();
                      setOpenclawSupportStatus(await getOpenClawSupportStatus());
                      onNotify?.('success', 'System context refreshed');
                    } catch (error) {
                      const message = error instanceof Error ? error.message : 'Failed to refresh system context';
                      onNotify?.('error', message);
                    } finally {
                      setSystemContextWriting(false);
                    }
                  }}
                >
                  {systemContextWriting ? 'Refreshing...' : 'Write system context'}
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-fit"
                  disabled={supportRefreshing}
                  onClick={async () => {
                    setSupportRefreshing(true);
                    try {
                      setOpenclawSupportStatus(await getOpenClawSupportStatus());
                    } catch (error) {
                      const message = error instanceof Error ? error.message : 'Failed to refresh support status';
                      onNotify?.('error', message);
                    } finally {
                      setSupportRefreshing(false);
                    }
                  }}
                >
                  {supportRefreshing ? 'Refreshing...' : 'Refresh status'}
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-fit"
                  disabled={syncMode !== 'Remote'}
                  onClick={() => void copyRemoteInstallCommand()}
                >
                  <ClipboardCopy className="mr-1 h-3 w-3" />
                  {remoteInstallCopied ? 'Copied' : 'Copy remote install command'}
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-fit"
                  onClick={async () => {
                    try {
                      const content = await getExtensionContent();
                      const copiedOk = await copyText(content);
                      if (!copiedOk) {
                        throw new Error('Clipboard write failed');
                      }
                      setExtensionCopied(true);
                      onNotify?.('success', 'Extension content copied');
                      setTimeout(() => setExtensionCopied(false), 1500);
                    } catch (error) {
                      const message = error instanceof Error ? error.message : 'Failed to copy extension content';
                      onNotify?.('error', message);
                    }
                  }}
                >
                  <ClipboardCopy className="mr-1 h-3 w-3" />
                  {extensionCopied ? 'Copied' : 'Copy extension content'}
                </Button>
              </div>
              {syncMode === 'Remote' ? (
                <div className="rounded-lg border border-neutral-200 px-3 py-2 text-[11px] leading-5 dark:border-neutral-700">
                  Recommended remote path:
                  {' '}
                  save your remote URL and bearer token, copy the remote install command, run it on the machine where OpenClaw is hosted, restart OpenClaw if needed, then click
                  {' '}
                  <span className="font-medium">Test sync connection</span>
                  {' '}
                  and
                  {' '}
                  <span className="font-medium">Test chat connection</span>
                  .
                </div>
              ) : null}
            </div>
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
                  const copiedOk = await copyText(info);
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
                  openclawChatTransportMode: chatTransportMode,
                  openclawChatWsUrl: chatWsUrl.trim() || null,
                  openclawChatSessionKey: chatSessionKey.trim() || null,
                  openclawSyncMode: syncMode,
                  openclawRemoteUrl: remoteUrl.trim() || null,
                  openclawSyncIntervalMs: syncIntervalMs,
                });

                if (clearChatToken) {
                  await clearOpenclawChatToken();
                } else if (chatToken.trim().length > 0) {
                  await setOpenclawChatToken(chatToken.trim());
                }

                if (clearRemoteToken) {
                  await clearOpenclawBearerToken();
                } else if (remoteBearerToken.trim().length > 0) {
                  await setOpenclawBearerToken(remoteBearerToken.trim());
                }

                refreshGatewayTransportConfig();
                baselineRef.current = buildSnapshot({
                  scanPaths: validScanPaths,
                  openclawWorkspacePath,
                  appSourcePath,
                  updateMode,
                  openclawContextPolicy,
                  chatTransportMode,
                  chatWsUrl,
                  chatSessionKey,
                  chatToken: '',
                  clearChatToken: false,
                  syncMode,
                  remoteUrl,
                  syncIntervalMs,
                  remoteBearerToken: '',
                  clearRemoteToken: false,
                });
                setChatToken('');
                setClearChatToken(false);
                setRemoteBearerToken('');
                setClearRemoteToken(false);
                setChatCheck(IDLE_CHECK_STATE);
                setSyncCheck(IDLE_CHECK_STATE);
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
