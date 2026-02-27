import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { spawn, type IPty } from 'tauri-pty';
import '@xterm/xterm/css/xterm.css';
import type { HubChat } from '../../lib/hub-types';
import { useDashboardStore } from '../../lib/store';
import { getAgentCommand, tmuxSessionName } from '../../lib/terminal-utils';

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'tiff', 'tif']);

interface TerminalShellProps {
  chat: HubChat;
  onFocusChange?: (focused: boolean) => void;
}

export function TerminalShell({ chat, onFocusChange }: TerminalShellProps) {
  // Archived terminal — show static message, don't spawn a new PTY
  if (chat.archived) {
    return (
      <div className="flex flex-1 items-center justify-center min-h-0">
        <p className="text-sm text-neutral-500">Session ended</p>
      </div>
    );
  }
  return <LiveTerminal chat={chat} onFocusChange={onFocusChange} />;
}

function LiveTerminal({ chat, onFocusChange }: { chat: HubChat; onFocusChange?: (focused: boolean) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const ptyRef = useRef<IPty | null>(null);
  const mountedRef = useRef(false);
  const agentLaunchedRef = useRef(false);
  const [dragActive, setDragActive] = useState(false);

  const projects = useDashboardStore((s) => s.projects);

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
    agentLaunchedRef.current = false;

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
    const agentCommand = getAgentCommand(chat.agentType);

    // Spawn PTY with tmux
    // Use `name` for TERM (proper PTY option), keep env minimal — tauri-pty
    // merges with parent env so PATH/HOME/etc. are inherited.
    // COLORTERM=truecolor tells TUI apps (Claude Code) that 24-bit color is supported.
    let pty: IPty;
    try {
      pty = spawn('tmux', [
        '-u', '-f', '/dev/null', '-L', 'clawchestra',
        'new-session', '-A', '-s', sessionName,
        ';', 'set', 'status', 'off',
        // Disable alternate screen on the outer terminal (xterm.js) so all tmux
        // output goes to the normal buffer with scrollback. Without this, tmux
        // uses the alternate screen which has no scrollback — wheel events get
        // converted to up/down arrows instead of scrolling.
        ';', 'set', '-ga', 'terminal-overrides', ',xterm-256color:smcup@:rmcup@',
      ], {
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

      // Auto-launch agent: detect shell prompt then send command
      if (agentCommand && !agentLaunchedRef.current) {
        const text = new TextDecoder().decode(data);
        if (text.includes('$') || text.includes('%') || text.includes('#')) {
          agentLaunchedRef.current = true;
          // Small delay to let the shell fully initialize
          setTimeout(() => {
            pty.write(agentCommand + '\n');
          }, 100);
        }
      }
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
      // Shift+Enter → insert literal newline (zsh doesn't opt into Kitty keyboard protocol)
      if (event.shiftKey && event.key === 'Enter' && event.type === 'keydown') {
        pty.write('\n');
        return false;
      }
      return true; // Everything else goes to the terminal
    });

    // ResizeObserver for container resize → fit terminal
    let resizeTimeout: ReturnType<typeof setTimeout>;
    const resizeObserver = new ResizeObserver(() => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        try {
          fitAddon.fit();
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

    // Native drag-and-drop — Tauri gives us actual file paths from the OS.
    // The browser-level drag handlers (below) prevent ChatShell from
    // intercepting the drag, while this handler writes file paths to the PTY.
    let unlistenDragDrop: (() => void) | undefined;
    getCurrentWindow().onDragDropEvent((event) => {
      if (event.payload.type !== 'drop') return;
      const { paths, position } = event.payload;
      const rect = container.getBoundingClientRect();
      if (
        position.x < rect.left || position.x > rect.right ||
        position.y < rect.top || position.y > rect.bottom
      ) return;

      const imagePaths = paths.filter((p) => {
        const ext = p.split('.').pop()?.toLowerCase() ?? '';
        return IMAGE_EXTENSIONS.has(ext);
      });
      for (const p of imagePaths) {
        pty.write(p);
      }
    }).then((fn) => { unlistenDragDrop = fn; });

    return () => {
      mountedRef.current = false;
      clearTimeout(resizeTimeout);
      resizeObserver.disconnect();
      unlistenDragDrop?.();
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

  // Drag-and-drop handlers — stopPropagation prevents the window-level
  // ChatShell handler from intercepting image drops over the terminal.
  const onDragOver = useCallback((e: React.DragEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    setDragActive(true);
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.stopPropagation();
    setDragActive(false);
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setDragActive(false);
    // Actual file handling is done by the Tauri onDragDropEvent listener
    // registered in useEffect — it gets the real OS file paths.
  }, []);

  return (
    <div
      className={`flex flex-1 flex-col min-h-0 px-4 pt-3 pb-4 md:px-6 md:pb-6 rounded-lg transition-shadow ${dragActive ? 'ring-2 ring-[#DFFF00]/50' : ''}`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div
        ref={containerRef}
        className="terminal-shell flex-1 min-h-0"
      />
    </div>
  );
}
