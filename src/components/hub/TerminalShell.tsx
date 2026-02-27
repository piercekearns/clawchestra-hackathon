import { useEffect, useMemo, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { spawn, type IPty } from 'tauri-pty';
import '@xterm/xterm/css/xterm.css';
import type { HubChat } from '../../lib/hub-types';
import { useDashboardStore } from '../../lib/store';
import { getAgentCommand, tmuxSessionName } from '../../lib/terminal-utils';

interface TerminalShellProps {
  chat: HubChat;
}

export function TerminalShell({ chat }: TerminalShellProps) {
  // Archived terminal — show static message, don't spawn a new PTY
  if (chat.archived) {
    return (
      <div className="flex flex-1 items-center justify-center min-h-0">
        <p className="text-sm text-neutral-500">Session ended</p>
      </div>
    );
  }
  return <LiveTerminal chat={chat} />;
}

function LiveTerminal({ chat }: { chat: HubChat }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const ptyRef = useRef<IPty | null>(null);
  const mountedRef = useRef(false);
  const agentLaunchedRef = useRef(false);

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
      fontFamily: "'IBM Plex Mono', 'SF Mono', 'Cascadia Code', 'Fira Code', Menlo, Monaco, monospace",
      lineHeight: 1.15,
      scrollback: 5000,
      allowTransparency: true,
      theme: {
        background: 'transparent',
        foreground: '#e5e5e5',
        cursor: '#DFFF00',
        selectionBackground: '#DFFF0033',
        black: '#0a0a0a',
        red: '#ff5c57',
        green: '#5af78e',
        yellow: '#f3f99d',
        blue: '#57c7ff',
        magenta: '#ff6ac1',
        cyan: '#9aedfe',
        white: '#f1f1f0',
        brightBlack: '#686868',
        brightRed: '#ff5c57',
        brightGreen: '#5af78e',
        brightYellow: '#f3f99d',
        brightBlue: '#57c7ff',
        brightMagenta: '#ff6ac1',
        brightCyan: '#9aedfe',
        brightWhite: '#f1f1f0',
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
      pty = spawn('tmux', ['new-session', '-A', '-s', sessionName, ';', 'set', 'status', 'off'], {
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
      return true; // Everything else goes to the terminal
    });

    // Intercept scroll wheel at the capture phase so it scrolls xterm.js's
    // scrollback buffer instead of being forwarded to tmux as mouse events
    // (which tmux converts to up/down arrow = command history cycling).
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      const lines = Math.max(1, Math.ceil(Math.abs(e.deltaY) / 25));
      term.scrollLines(e.deltaY > 0 ? lines : -lines);
    };
    container.addEventListener('wheel', handleWheel, { capture: true, passive: false });

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

    // Focus terminal
    term.focus();

    return () => {
      mountedRef.current = false;
      clearTimeout(resizeTimeout);
      resizeObserver.disconnect();
      container.removeEventListener('wheel', handleWheel, { capture: true } as EventListenerOptions);
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

  return (
    <div
      ref={containerRef}
      className="terminal-shell flex-1 min-h-0"
      style={{ padding: '8px 8px 4px 12px' }}
    />
  );
}
