import { watch } from '@tauri-apps/plugin-fs';
import { isTauriRuntime } from './tauri';

export async function watchProjects(
  scanPaths: string[],
  onChanged: () => void,
): Promise<() => void> {
  if (!isTauriRuntime() || scanPaths.length === 0) {
    return () => undefined;
  }

  let timeout: ReturnType<typeof setTimeout>;

  const onEvent = () => {
    clearTimeout(timeout);
    timeout = setTimeout(onChanged, 150);
  };

  const unwatchers: Array<Awaited<ReturnType<typeof watch>>> = [];

  for (const scanPath of scanPaths) {
    try {
      const unwatch = await watch(scanPath, onEvent, { recursive: true });
      unwatchers.push(unwatch);
    } catch {
      try {
        const unwatch = await watch(scanPath, onEvent, { recursive: false });
        unwatchers.push(unwatch);
      } catch {
        // Skip paths that can't be watched at all
      }
    }
  }

  return () => {
    clearTimeout(timeout);
    for (const unwatch of unwatchers) {
      void unwatch();
    }
  };
}
