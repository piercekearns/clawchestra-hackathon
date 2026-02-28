import { getCurrentWindow } from '@tauri-apps/api/window';
import { useDashboardStore } from '../lib/store';
import { tmuxKillAllClawchestraSessions } from '../lib/tauri';
import { ModalDragZone } from './ui/ModalDragZone';

export function QuitGuardDialog() {
  const open = useDashboardStore((s) => s.quitGuardOpen);
  const setOpen = useDashboardStore((s) => s.setQuitGuardOpen);
  const activeCount = useDashboardStore((s) => s.activeTerminalChatIds.size);

  if (!open) return null;

  const handleCancel = () => setOpen(false);

  const handleQuit = async () => {
    await tmuxKillAllClawchestraSessions();
    await getCurrentWindow().close();
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-neutral-950/40 p-4 backdrop-blur-sm">
      <ModalDragZone />
      <div className="w-full max-w-sm rounded-2xl border border-neutral-200 bg-neutral-0 p-5 shadow-xl dark:border-neutral-700 dark:bg-neutral-900">
        <h2 className="text-sm font-medium text-neutral-800 dark:text-neutral-200">
          {activeCount === 1
            ? 'You have 1 active terminal session'
            : `You have ${activeCount} active terminal sessions`}
        </h2>
        <p className="mt-1.5 text-xs text-neutral-500 dark:text-neutral-400">
          Quitting will end them. Running agents (Claude Code, Codex, etc.) will be stopped.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={handleCancel}
            className="rounded-lg border border-neutral-200 px-3 py-1.5 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-100 dark:border-neutral-600 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleQuit()}
            className="rounded-lg bg-red-500 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-600"
          >
            Quit anyway
          </button>
        </div>
      </div>
    </div>
  );
}
