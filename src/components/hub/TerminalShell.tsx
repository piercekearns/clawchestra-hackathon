import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { spawn, type IPty } from 'tauri-pty';
import '@xterm/xterm/css/xterm.css';
import { Loader2 } from 'lucide-react';
import type { HubChat } from '../../lib/hub-types';
import { useDashboardStore } from '../../lib/store';
import { buildTerminalLaunchPlan, type RuntimeMode, type RuntimeNotice } from '../../lib/terminal-launch';
import { getAgentLaunchSpec, tmuxSessionName } from '../../lib/terminal-utils';
import { detectActionRequired } from '../../lib/terminal-activity';
import { Button } from '../ui/button';
import {
  detectAgents,
  getTerminalDependencyStatus,
  type TerminalDependencyStatus,
  writeTempFile,
} from '../../lib/tauri';

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'tiff', 'tif']);

interface TerminalShellProps {
  chat: HubChat;
  onFocusChange?: (focused: boolean) => void;
  onDragActiveChange?: (active: boolean) => void;
}

export function TerminalShell({ chat, onFocusChange, onDragActiveChange }: TerminalShellProps) {
  // Archived terminal — show static message, don't spawn a new PTY
  if (chat.archived) {
    return (
      <div className="flex flex-1 items-center justify-center min-h-0">
        <p className="text-sm text-neutral-500">Session ended</p>
      </div>
    );
  }
  return <LiveTerminal chat={chat} onFocusChange={onFocusChange} onDragActiveChange={onDragActiveChange} />;
}

function LiveTerminal({ chat, onFocusChange, onDragActiveChange }: { chat: HubChat; onFocusChange?: (focused: boolean) => void; onDragActiveChange?: (active: boolean) => void }) {
  const platform = useMemo(() => {
    if (typeof navigator === 'undefined') return 'unknown';
    const raw = `${navigator.platform} ${navigator.userAgent}`.toLowerCase();
    if (raw.includes('win')) return 'windows';
    if (raw.includes('mac') || raw.includes('iphone') || raw.includes('ipad')) return 'macos';
    if (raw.includes('linux')) return 'linux';
    return 'unknown';
  }, []);
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const ptyRef = useRef<IPty | null>(null);
  const runtimeModeRef = useRef<RuntimeMode>('tmux');
  const mountedRef = useRef(false);
  const [dragActive, setDragActive] = useState(false);
  const [modeOverride, setModeOverride] = useState<'auto' | 'install-tmux'>('auto');
  const [runtimeNotice, setRuntimeNotice] = useState<RuntimeNotice | null>(null);
  const [dependencyStatus, setDependencyStatus] = useState<TerminalDependencyStatus | null>(null);
  const [launchNonce, setLaunchNonce] = useState(0);

  const projects = useDashboardStore((s) => s.projects);
  const detectedAgents = useDashboardStore((s) => s.detectedAgents);

  // Resolve project dirPath from the store's project tree
  const projectDirPath = useMemo(() => {
    const find = (ps: typeof projects): string | undefined => {
      for (const p of ps) {
        if (p.id === chat.projectId) return p.dirPath;
        if (p.children) {
          const found = find(p.children);
          if (found) return found;
        }
      }
      return undefined;
    };
    return find(projects);
  }, [chat.projectId, projects]);

  useEffect(() => {
    let cancelled = false;
    void getTerminalDependencyStatus()
      .then((status) => {
        if (!cancelled) setDependencyStatus(status);
      })
      .catch(() => {
        if (!cancelled) setDependencyStatus(null);
      });
    return () => {
      cancelled = true;
    };
  }, [detectedAgents]);

  useEffect(() => {
    // Prevent double-init in StrictMode
    if (mountedRef.current) return;
    mountedRef.current = true;

    const container = containerRef.current;
    if (!container) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "'SF Mono', Menlo, 'Cascadia Code', 'Fira Code', 'IBM Plex Mono', Monaco, monospace",
      lineHeight: 1.0,
      scrollback: 5000,
      allowTransparency: true,
      vtExtensions: { kittyKeyboard: true },
      theme: {
        background: 'transparent',
        foreground: '#d4d4d4',
        cursor: '#DFFF00',
        selectionBackground: '#DFFF0030',
        // black must be visible on transparent bg (progress bar tracks, borders)
        black: '#2a2a2a',
        red: '#ff6b6b',
        green: '#5af78e',
        yellow: '#ffd866',
        blue: '#7b93a8',
        magenta: '#e88ad4',
        cyan: '#7dcfea',
        white: '#d4d4d4',
        brightBlack: '#666666',
        brightRed: '#ff8f8f',
        brightGreen: '#69ff94',
        brightYellow: '#ffe0a0',
        brightBlue: '#a0b8ce',
        brightMagenta: '#f0a8e0',
        brightCyan: '#a0dfef',
        brightWhite: '#f0f0f0',
      },
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(container);

    // Initial fit
    try {
      fitAddon.fit();
    } catch {
      // Container may not be visible yet
    }

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    const sessionName = tmuxSessionName(chat.projectId, chat.id);
    const agentLaunch = getAgentLaunchSpec(chat.agentType, detectedAgents);
    const tmux = dependencyStatus?.tmuxPath
      ?? detectedAgents.find((a) => a.agentType === 'tmux' && a.available)?.path
      ?? null;
    const launchPlan = buildTerminalLaunchPlan({
      platform,
      sessionName,
      agentCommand: agentLaunch.command,
      agentPrefersShell: agentLaunch.prefersShell,
      agentShellPath: agentLaunch.shellPath,
      tmuxPath: tmux,
      projectDirPath,
      dependencyStatus,
      modeOverride,
    });

    runtimeModeRef.current = launchPlan.mode;
    setRuntimeNotice(launchPlan.notice);

    for (const line of launchPlan.writeLines) {
      term.writeln(`\r\n${line}`);
    }

    if (!launchPlan.command) {
      return () => {
        mountedRef.current = false;
        const store = useDashboardStore.getState();
        const updated = new Set(store.activeTerminalChatIds);
        updated.delete(chat.id);
        store.setActiveTerminalChatIds(updated);
        store.updateTerminalActivity(chat.id, { isActive: false, actionRequired: false });
        term.dispose();
        termRef.current = null;
        fitAddonRef.current = null;
      };
    }

    let pty: IPty;
    try {
      pty = spawn(launchPlan.command, launchPlan.args, {
        name: 'xterm-256color',
        cols: term.cols,
        rows: term.rows,
        cwd: projectDirPath ?? undefined,
        env: { TERM: 'xterm-256color', COLORTERM: 'truecolor' },
      });
    } catch (e) {
      term.writeln(`\r\n[Error] Failed to spawn terminal: ${e}`);
      return () => {
        mountedRef.current = false;
        term.dispose();
        termRef.current = null;
        fitAddonRef.current = null;
      };
    }

    ptyRef.current = pty;

    // Mark session as active immediately on spawn
    {
      const store = useDashboardStore.getState();
      const updated = new Set(store.activeTerminalChatIds);
      updated.add(chat.id);
      store.setActiveTerminalChatIds(updated);
    }

    // Wire PTY output → terminal display
    // The pane is VISIBLE (mounted) here — the user can see everything. So:
    // - lastViewedAt = lastOutputAt (never "unread", no notification bubbles)
    // - Track isActive for sidebar dots (agent working indicator)
    // - Never set actionRequired (user can see prompts themselves)
    //
    // Activity detection — two mechanisms work together:
    //
    // ACTIVATION: Sliding window filters one-off bursts (tab suggestion,
    // title updates). Need output in 2 of 5 recent 200ms windows to start.
    //
    // DEACTIVATION: Two paths:
    // 1. Silence timer (1.5s) — resets only on data >= 3 bytes (filters
    //    cursor reports, keep-alive). Fires when real output stops.
    // 2. Window backstop — if active but 0 of last 5 windows were
    //    significant (>= 5 bytes), force-deactivate. Catches cases
    //    where periodic noise data prevents silence timer from firing.
    //
    // USER INPUT: All data during echo (300ms after keypress) is ignored
    // for both activation and deactivation checks.
    const spawnTime = Date.now();
    let lastUserInputAt = 0;
    let lastWindowCheck = 0;
    let bytesSinceLastWindow = 0;
    // Seed from store — if the background poll had this terminal as active,
    // carry that forward so the dots don't pause during the startup grace period.
    const prevActivity = useDashboardStore.getState().terminalActivity[chat.id];
    let isCurrentlyActive = !!prevActivity?.isActive;
    let lastSignificantAt = isCurrentlyActive ? Date.now() : 0;
    const significantHistory: boolean[] = [];

    const STARTUP_GRACE_MS = 3_000;   // scrollback restore + tmux reattach; 10s was too long — short agent responses were missed entirely
    const USER_INPUT_SUPPRESS_MS = 300;
    const WINDOW_MS = 200;            // check every 200ms
    const BYTE_THRESHOLD = 5;         // bytes per window to count as significant
    const HISTORY_SIZE = 5;           // track last 5 windows (1s)
    const MIN_ACTIVE_WINDOWS = 2;     // 2 of 5 must be significant to activate
    const DEACTIVATE_MS = 1500;       // deactivate after 1.5s without significant output

    const deactivate = () => {
      isCurrentlyActive = false;
      significantHistory.length = 0;
      const buffer = term.buffer.active;
      const lines: string[] = [];
      const end = buffer.baseY + buffer.cursorY;
      const start = Math.max(0, end - 20);
      for (let i = start; i <= end; i++) {
        const line = buffer.getLine(i);
        if (line) lines.push(line.translateToString(true));
      }
      const text = lines.join('\n');
      const actionRequired = detectActionRequired(text);
      useDashboardStore.getState().updateTerminalActivity(chat.id, {
        isActive: false,
        actionRequired,
      });
    };

    // Periodic deactivation check — runs every 500ms independently of
    // data events. This avoids relying on silence timers that get reset
    // by prompt renders, cursor reports, and other periodic terminal noise.
    const deactivateInterval = setInterval(() => {
      if (isCurrentlyActive && lastSignificantAt > 0 && Date.now() - lastSignificantAt > DEACTIVATE_MS) {
        deactivate();
      }
    }, 500);

    // After startup grace, re-evaluate actionRequired from the terminal buffer.
    // markTerminalViewed no longer clears it (the user must actually resolve the
    // prompt), but if the prompt has already scrolled away (stale detection), this
    // one-shot check clears the amber dot without waiting for new output.
    const postGraceCheck = setTimeout(() => {
      const prev = useDashboardStore.getState().terminalActivity[chat.id];
      const buffer = term.buffer.active;
      const lines: string[] = [];
      const end = buffer.baseY + buffer.cursorY;
      const start = Math.max(0, end - 20);
      for (let i = start; i <= end; i++) {
        const line = buffer.getLine(i);
        if (line) lines.push(line.translateToString(true));
      }
      const text = lines.join('\n');
      const updates: Record<string, unknown> = {};
      if (prev?.actionRequired && !detectActionRequired(text)) {
        updates.actionRequired = false;
      }
      if (Object.keys(updates).length > 0) {
        useDashboardStore.getState().updateTerminalActivity(chat.id, updates);
      }
    }, STARTUP_GRACE_MS + 500);

    const dataDisposable = pty.onData((data: Uint8Array) => {
      term.write(data);

      const now = Date.now();

      // Skip during startup (scrollback restore)
      if (now - spawnTime < STARTUP_GRACE_MS) return;

      // Skip byte counting during user input echo — prevents typing from
      // activating dots.
      if (now - lastUserInputAt < USER_INPUT_SUPPRESS_MS) return;

      bytesSinceLastWindow += data.length;

      if (now - lastWindowCheck >= WINDOW_MS) {
        const isSignificant = bytesSinceLastWindow >= BYTE_THRESHOLD;
        lastWindowCheck = now;
        bytesSinceLastWindow = 0;

        significantHistory.push(isSignificant);
        if (significantHistory.length > HISTORY_SIZE) significantHistory.shift();

        if (isSignificant) {
          lastSignificantAt = now;
        }

        if (!isCurrentlyActive) {
          const activeWindows = significantHistory.filter(Boolean).length;
          if (activeWindows >= MIN_ACTIVE_WINDOWS) {
            isCurrentlyActive = true;
            useDashboardStore.getState().updateTerminalActivity(chat.id, {
              lastOutputAt: now,
              lastViewedAt: now,
              isActive: true,
              // Clear action-required — user is watching,
              // and resumed output means the prompt was answered.
              actionRequired: false,
            });
          }
        } else if (isSignificant) {
          // Already active with real output — update timestamps
          useDashboardStore.getState().updateTerminalActivity(chat.id, {
            lastOutputAt: now,
            lastViewedAt: now,
          });
        }
      }
    });

    // Wire terminal input → PTY
    const inputDisposable = term.onData((data: string) => {
      lastUserInputAt = Date.now();
      pty.write(data);
    });

    // Wire terminal resize → PTY resize
    const resizeDisposable = term.onResize(({ cols, rows }) => {
      try {
        pty.resize(cols, rows);
      } catch {
        // PTY may have already exited
      }
    });

    // PTY exit — immediately mark as dead (no need to wait for next poll)
    const exitDisposable = pty.onExit(({ exitCode }) => {
      term.writeln(`\r\n[Session ended with code ${exitCode}]`);
      isCurrentlyActive = false;
      significantHistory.length = 0;
      clearInterval(deactivateInterval);
      const store = useDashboardStore.getState();
      const updated = new Set(store.activeTerminalChatIds);
      updated.delete(chat.id);
      store.setActiveTerminalChatIds(updated);
      store.updateTerminalActivity(chat.id, { isActive: false, actionRequired: false });

      if (runtimeModeRef.current === 'install') {
        void detectAgents()
          .then((agents) => {
            useDashboardStore.getState().setDetectedAgents(agents);
          })
          .catch(() => {});
        void getTerminalDependencyStatus()
          .then((status) => setDependencyStatus(status))
          .catch(() => {});
        setModeOverride('auto');
        setLaunchNonce((current) => current + 1);
      }
    });

    // Pass through app keyboard shortcuts while terminal has focus
    term.attachCustomKeyEventHandler((event) => {
      if (event.metaKey && (event.key === 'k' || event.key === 'n' || event.key === 'w')) {
        return false; // Let the app handle Cmd+K, Cmd+N, Cmd+W
      }
      // Shift+Enter → insert literal newline. Ctrl-V (\x16) is "quoted-insert"
      // in zsh/bash, making the shell treat the next char as literal. This
      // avoids the overhead of bracketed paste mode for snappier response.
      if (event.shiftKey && event.key === 'Enter') {
        if (event.type === 'keydown') {
          pty.write('\x16\n');
        }
        return false;
      }
      return true; // Everything else goes to the terminal
    });

    // ResizeObserver for container resize → fit terminal.
    // After fit(), scroll to bottom so TUI apps (Claude Code) whose prompt
    // lives at the bottom of the viewport stay pinned there during redraws.
    let resizeTimeout: ReturnType<typeof setTimeout>;
    const resizeObserver = new ResizeObserver(() => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        try {
          fitAddon.fit();
          term.scrollToBottom();
        } catch {
          // Container may have been unmounted
        }
      }, 100);
    });
    resizeObserver.observe(container);

    // Track terminal focus — notify parent for drawer-level visual
    const textarea = term.textarea;
    const onFocus = () => onFocusChange?.(true);
    const onBlur = () => onFocusChange?.(false);
    textarea?.addEventListener('focus', onFocus);
    textarea?.addEventListener('blur', onBlur);

    // Focus terminal
    term.focus();

    return () => {
      mountedRef.current = false;
      clearTimeout(resizeTimeout);
      clearTimeout(postGraceCheck);
      clearInterval(deactivateInterval);
      resizeObserver.disconnect();
      textarea?.removeEventListener('focus', onFocus);
      textarea?.removeEventListener('blur', onBlur);
      dataDisposable.dispose();
      inputDisposable.dispose();
      resizeDisposable.dispose();
      exitDisposable.dispose();

      // Clear the capture hash so the background poll seeds fresh from
      // tmuxCapturePane (same source it uses for comparison). If the
      // terminal was actively outputting, stamp lastOutputAt so unread
      // shows even if the terminal finishes before the second poll.
      {
        const prev = useDashboardStore.getState().terminalActivity[chat.id];
        const wasActive = prev?.isActive || isCurrentlyActive;
        useDashboardStore.getState().updateTerminalActivity(chat.id, {
          lastCaptureHash: '',
          ...(wasActive ? { lastOutputAt: Date.now() } : {}),
        });
      }

      // Kill PTY attachment only — tmux session keeps running
      try {
        pty.kill();
      } catch {
        // Already dead
      }
      if (runtimeModeRef.current !== 'tmux') {
        const store = useDashboardStore.getState();
        const updated = new Set(store.activeTerminalChatIds);
        updated.delete(chat.id);
        store.setActiveTerminalChatIds(updated);
        store.updateTerminalActivity(chat.id, { isActive: false, actionRequired: false });
      }
      ptyRef.current = null;
      term.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
    };
  }, [chat.id, chat.projectId, chat.agentType, dependencyStatus, detectedAgents, launchNonce, modeOverride, platform, projectDirPath]); // eslint-disable-line react-hooks/exhaustive-deps

  // Drag-and-drop handlers — stopPropagation on ALL drag events prevents the
  // window-level ChatShell handler from catching drags over the terminal.
  // Missing any event (especially dragenter) leaves ChatShell's dragDepth
  // counter stuck > 0, causing a permanent glow.
  const setDrag = useCallback((active: boolean) => {
    setDragActive(active);
    onDragActiveChange?.(active);
  }, [onDragActiveChange]);

  // Use capture-phase drag listeners so events are caught before xterm.js
  // can swallow them — without this, drag-and-drop only works when the
  // terminal has focus (click-to-activate).
  const wrapperRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const enter = (e: DragEvent) => { e.stopPropagation(); e.preventDefault(); setDrag(true); };
    const over = (e: DragEvent) => { e.stopPropagation(); e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; setDrag(true); };
    const leave = (e: DragEvent) => { e.stopPropagation(); setDrag(false); };
    const drop = (e: DragEvent) => {
      e.stopPropagation();
      e.preventDefault();
      setDrag(false);
      const pty = ptyRef.current;
      if (!pty) return;
      const files = Array.from(e.dataTransfer?.files ?? []);
      for (const file of files) {
        const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
        if (!IMAGE_EXTENSIONS.has(ext)) continue;
        void file.arrayBuffer().then((buf) => {
          const bytes = Array.from(new Uint8Array(buf));
          void writeTempFile(file.name || `clawchestra-drop-${Date.now()}.${ext}`, bytes)
            .then((filePath) => pty.write(filePath))
            .catch((err) => console.error('Failed to save dropped image:', err));
        }).catch((err) => console.error('Failed to save dropped image:', err));
      }
    };
    el.addEventListener('dragenter', enter, true);
    el.addEventListener('dragover', over, true);
    el.addEventListener('dragleave', leave, true);
    el.addEventListener('drop', drop, true);
    return () => {
      el.removeEventListener('dragenter', enter, true);
      el.removeEventListener('dragover', over, true);
      el.removeEventListener('dragleave', leave, true);
      el.removeEventListener('drop', drop, true);
    };
  }, [setDrag]);

  return (
    <div
      ref={wrapperRef}
      className="relative flex flex-1 flex-col min-h-0 px-4 pt-3 pb-4 md:px-6 md:pb-6"
    >
      {runtimeNotice && (
        <div className="pointer-events-auto absolute left-4 right-4 top-3 z-20 md:left-6 md:right-6">
          <div className={`max-w-2xl rounded-xl border px-4 py-3 shadow-lg backdrop-blur ${
            runtimeNotice.tone === 'warning'
              ? 'border-amber-300/70 bg-amber-50/95 text-amber-950 dark:border-amber-700 dark:bg-amber-950/85 dark:text-amber-100'
              : 'border-sky-300/70 bg-sky-50/95 text-sky-950 dark:border-sky-700 dark:bg-sky-950/85 dark:text-sky-100'
          }`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold">{runtimeNotice.title}</p>
                <p className="mt-1 text-xs leading-5 opacity-90">{runtimeNotice.body}</p>
              </div>
              {modeOverride === 'install-tmux' ? (
                <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" />
              ) : null}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {runtimeNotice.allowInstall && modeOverride !== 'install-tmux' ? (
                <Button
                  type="button"
                  size="sm"
                  onClick={() => {
                    setModeOverride('install-tmux');
                    setLaunchNonce((current) => current + 1);
                  }}
                >
                  {dependencyStatus?.installerLabel ?? 'Install tmux'}
                </Button>
              ) : null}
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => setLaunchNonce((current) => current + 1)}
              >
                Retry terminal
              </Button>
            </div>
          </div>
        </div>
      )}
      {dragActive && (
        <div className="pointer-events-none absolute inset-0 z-10 border-2 border-dashed border-revival-accent-400 bg-revival-accent-200/10 dark:bg-revival-accent-900/20" />
      )}
      <div
        ref={containerRef}
        className="terminal-shell flex-1 min-h-0"
      />
    </div>
  );
}
