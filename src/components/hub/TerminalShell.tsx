import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { writeFile } from '@tauri-apps/plugin-fs';
import { spawn, type IPty } from 'tauri-pty';
import '@xterm/xterm/css/xterm.css';
import type { HubChat } from '../../lib/hub-types';
import { useDashboardStore } from '../../lib/store';
import { getAgentCommand, tmuxSessionName } from '../../lib/terminal-utils';

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
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const ptyRef = useRef<IPty | null>(null);
  const mountedRef = useRef(false);
  const [dragActive, setDragActive] = useState(false);

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
    const agentCommand = getAgentCommand(chat.agentType, detectedAgents);

    // Spawn PTY with tmux via a shell wrapper.
    //
    // Phase 1: capture-pane dumps existing scrollback (with ANSI escapes)
    //   into xterm.js's buffer so the user can scroll up after an app restart.
    // Phase 2: has-session checks if the tmux session already exists.
    // Phase 3: exec tmux replaces the outer shell with the tmux client.
    //   For NEW sessions with an agent, tmux `send-keys` types the launch
    //   command into the shell. For existing sessions (reattach), nothing
    //   extra is sent — the agent is already running.
    //
    // Note: tmux sanitizes colons to underscores in session names, so all
    //   `-t` targets must use the sanitized form.
    //
    // Use `name` for TERM (proper PTY option), keep env minimal — tauri-pty
    // merges with parent env so PATH/HOME/etc. are inherited.
    // COLORTERM=truecolor tells TUI apps (Claude Code) that 24-bit color is supported.
    const tmuxSessionSanitized = sessionName.replace(/:/g, '_');
    const captureCmd = `tmux -L clawchestra capture-pane -t '${tmuxSessionSanitized}' -p -e -S -5000 2>/dev/null`;
    const hasSessionCheck = `tmux -L clawchestra has-session -t '${tmuxSessionSanitized}' 2>/dev/null && IS_REATTACH=1 || IS_REATTACH=0`;
    const tmuxBase = [
      `tmux -u -f /dev/null -L clawchestra`,
      `new-session -A -s '${sessionName}'`,
      `\\; set status off`,
      // Bump history-limit from the default 2000 to 50 000 so long Claude Code
      // sessions preserve more scrollback for capture-pane on reattach.
      `\\; set history-limit 50000`,
      // Disable alternate screen on the outer terminal (xterm.js) so all tmux
      // output goes to the normal buffer with scrollback. Without this, tmux
      // uses the alternate screen which has no scrollback — wheel events get
      // converted to up/down arrows instead of scrolling.
      `\\; set -ga terminal-overrides ',xterm-256color:smcup@:rmcup@'`,
    ].join(' ');

    // Build the full shell command. For agents, conditionally add send-keys
    // only for new sessions (IS_REATTACH=0) so we don't retype into an
    // already-running agent on reattach.
    let shellCmd: string;
    if (agentCommand) {
      // Escape single quotes in the command path for the shell
      const escapedCmd = agentCommand.replace(/'/g, "'\\''");
      shellCmd = [
        captureCmd,
        hasSessionCheck,
        `if [ "$IS_REATTACH" = "0" ]; then exec ${tmuxBase} \\; send-keys '${escapedCmd}' Enter; else exec ${tmuxBase}; fi`,
      ].join('; ');
    } else {
      shellCmd = `${captureCmd}; exec ${tmuxBase}`;
    }
    let pty: IPty;
    try {
      pty = spawn('sh', ['-c', shellCmd], {
        name: 'xterm-256color',
        cols: term.cols,
        rows: term.rows,
        cwd: projectDirPath ?? undefined,
        env: { TERM: 'xterm-256color', COLORTERM: 'truecolor' },
      });
    } catch (e) {
      term.writeln(`\r\n[Error] Failed to spawn terminal: ${e}`);
      return;
    }

    ptyRef.current = pty;

    // Wire PTY output → terminal display
    const dataDisposable = pty.onData((data: Uint8Array) => {
      term.write(data);
    });

    // Wire terminal input → PTY
    const inputDisposable = term.onData((data: string) => {
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

    // PTY exit
    const exitDisposable = pty.onExit(({ exitCode }) => {
      term.writeln(`\r\n[Session ended with code ${exitCode}]`);
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
      resizeObserver.disconnect();
      textarea?.removeEventListener('focus', onFocus);
      textarea?.removeEventListener('blur', onBlur);
      dataDisposable.dispose();
      inputDisposable.dispose();
      resizeDisposable.dispose();
      exitDisposable.dispose();
      // Kill PTY attachment only — tmux session keeps running
      try {
        pty.kill();
      } catch {
        // Already dead
      }
      ptyRef.current = null;
      term.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
    };
  }, [chat.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Drag-and-drop handlers — stopPropagation on ALL drag events prevents the
  // window-level ChatShell handler from catching drags over the terminal.
  // Missing any event (especially dragenter) leaves ChatShell's dragDepth
  // counter stuck > 0, causing a permanent glow.
  const setDrag = useCallback((active: boolean) => {
    setDragActive(active);
    onDragActiveChange?.(active);
  }, [onDragActiveChange]);

  const onDragEnter = useCallback((e: React.DragEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setDrag(true);
  }, [setDrag]);

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    setDrag(true);
  }, [setDrag]);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.stopPropagation();
    setDrag(false);
  }, [setDrag]);

  const onDrop = useCallback(async (e: React.DragEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setDrag(false);

    // dragDropEnabled is false in tauri.conf.json, so Tauri's native
    // onDragDropEvent never fires. Handle file drops via the browser File API:
    // save image to /tmp, then write the path to the PTY (same as native
    // terminals like Ghostty where dragging an image pastes its file path).
    const pty = ptyRef.current;
    if (!pty) return;

    const files = Array.from(e.dataTransfer?.files ?? []);
    for (const file of files) {
      const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
      if (!IMAGE_EXTENSIONS.has(ext)) continue;

      try {
        const buffer = await file.arrayBuffer();
        const filePath = `/tmp/clawchestra-drop-${Date.now()}.${ext}`;
        await writeFile(filePath, new Uint8Array(buffer));
        pty.write(filePath);
      } catch (err) {
        console.error('Failed to save dropped image:', err);
      }
    }
  }, [setDrag]);

  return (
    <div
      className="relative flex flex-1 flex-col min-h-0 px-4 pt-3 pb-4 md:px-6 md:pb-6"
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
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
