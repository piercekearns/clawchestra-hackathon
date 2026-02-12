import { watch } from '@tauri-apps/plugin-fs';
import { isTauriRuntime } from './tauri';

export async function watchProjects(
  projectsDir: string,
  onChanged: () => void,
): Promise<() => void> {
  if (!isTauriRuntime()) {
    return () => undefined;
  }

  let timeout: ReturnType<typeof setTimeout>;

  const onEvent = () => {
    clearTimeout(timeout);
    timeout = setTimeout(onChanged, 150);
  };

  let unwatch: Awaited<ReturnType<typeof watch>>;
  try {
    unwatch = await watch(projectsDir, onEvent, { recursive: true });
  } catch {
    // Some environments fail recursive watchers on large trees; fall back to shallow watch.
    unwatch = await watch(projectsDir, onEvent, { recursive: false });
  }

  return () => {
    clearTimeout(timeout);
    void unwatch();
  };
}
