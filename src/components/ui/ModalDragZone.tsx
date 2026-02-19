import { getCurrentWindow } from '@tauri-apps/api/window';

const TITLE_BAR_HEIGHT = 46;

/**
 * Invisible drag zone overlaid at the top of modal backdrops.
 * Allows the user to drag the window from the title bar area
 * even when a full-screen modal overlay is open.
 */
export function ModalDragZone() {
  return (
    <div
      className="absolute inset-x-0 top-0 z-[60]"
      style={{ height: TITLE_BAR_HEIGHT, cursor: 'grab' }}
      onMouseDown={() => {
        void getCurrentWindow().startDragging().catch(() => {});
      }}
    />
  );
}
