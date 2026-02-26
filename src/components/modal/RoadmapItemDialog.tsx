import { useCallback, useEffect, useRef, useState } from 'react';
import { MessageSquare, X } from 'lucide-react';
import { ModalDragZone } from '../ui/ModalDragZone';
import type { ProjectFrontmatter, RoadmapItem, RoadmapItemWithDocs, RoadmapStatus } from '../../lib/schema';
import { resolveDocFiles, enrichItemsWithDocs } from '../../lib/doc-resolution';
import { readFile, gitReadFileAtRef, gitGetBranchStates, getProject, isTauriRuntime } from '../../lib/tauri';
import { RoadmapItemDetail } from './RoadmapItemDetail';

interface RoadmapItemDialogProps {
  item: RoadmapItem | null;
  projectTitle: string;
  projectDir: string;
  projectFrontmatter?: ProjectFrontmatter;
  projectId?: string;
  isMigrated?: boolean;
  onClose: () => void;
  onStatusChange: (itemId: string, status: RoadmapStatus) => void;
  onOpenChat?: (itemId: string, itemTitle: string) => void;
  boardScoped?: boolean;
}

/**
 * Standalone dialog for viewing roadmap item details from the kanban board.
 * Enriches a plain RoadmapItem with docs on open, then delegates to RoadmapItemDetail.
 */
export function RoadmapItemDialog({
  item,
  projectTitle,
  projectDir,
  projectFrontmatter,
  projectId,
  isMigrated,
  onClose,
  onStatusChange,
  onOpenChat,
  boardScoped,
}: RoadmapItemDialogProps) {
  const [enrichedItem, setEnrichedItem] = useState<RoadmapItemWithDocs | null>(null);
  const [docCache, setDocCache] = useState<Record<string, string>>({});
  const [docSourceBranch, setDocSourceBranch] = useState<Record<string, string>>({});
  const [docContentSource, setDocContentSource] = useState<Record<string, 'local' | 'synced-snapshot' | 'git-show'>>({});
  const [docLoading, setDocLoading] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Enrich item with docs when it changes
  useEffect(() => {
    if (!item) {
      setEnrichedItem(null);
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const dummyFrontmatter: ProjectFrontmatter = projectFrontmatter ?? {
          title: projectTitle,
          status: 'in-progress',
          priority: 1,
          type: 'project',
          lastActivity: '',
        };
        const docsMap = await resolveDocFiles(projectDir, [item], dummyFrontmatter);
        if (!cancelled) {
          const items = enrichItemsWithDocs([item], docsMap);
          setEnrichedItem(items[0] ?? { ...item, docs: {} });
        }
      } catch {
        if (!cancelled) {
          setEnrichedItem({ ...item, docs: {} });
        }
      }
    })();

    return () => { cancelled = true; };
  }, [item, projectDir, projectTitle, projectFrontmatter]);

  // Close on Escape
  useEffect(() => {
    if (!item) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [item, onClose]);

  const fetchDocContent = useCallback(async (path: string, opts?: { itemId?: string; docType?: 'spec' | 'plan' }): Promise<string> => {
    setDocLoading(true);
    try {
      // Step 1: Try local file (authoritative when present)
      const content = await readFile(path);
      setDocCache((prev) => ({ ...prev, [path]: content }));
      setDocContentSource((prev) => ({ ...prev, [path]: 'local' }));
      return content;
    } catch {
      // Step 2: Try db.json content field (synced snapshot)
      if (projectId && isMigrated && opts?.itemId && opts?.docType) {
        try {
          const detail = await getProject(projectId);
          const dbItem = detail.roadmapItems.find((ri) => ri.id === opts.itemId);
          const contentField = opts.docType === 'spec' ? dbItem?.specDocContent : dbItem?.planDocContent;
          if (contentField) {
            setDocCache((prev) => ({ ...prev, [path]: contentField }));
            setDocContentSource((prev) => ({ ...prev, [path]: 'synced-snapshot' }));
            const branchField = opts.docType === 'spec' ? dbItem?.specDocBranch : dbItem?.planDocBranch;
            if (branchField) setDocSourceBranch((prev) => ({ ...prev, [path]: branchField }));
            return contentField;
          }
        } catch {
          // get_project failed, continue
        }
      }

      // Step 3+4: git show fallback
      if (!projectDir) {
        const fallback = '_Document not available_';
        setDocCache((prev) => ({ ...prev, [path]: fallback }));
        return fallback;
      }

      const relPath = path.startsWith(projectDir)
        ? path.slice(projectDir.length).replace(/^\//, '')
        : path;

      try {
        // Step 3: Try branch hint from db.json
        let branchHint: string | undefined;
        if (projectId && isMigrated && opts?.itemId && opts?.docType) {
          try {
            const detail = await getProject(projectId);
            const dbItem = detail.roadmapItems.find((ri) => ri.id === opts.itemId);
            branchHint = opts.docType === 'spec' ? dbItem?.specDocBranch : dbItem?.planDocBranch;
          } catch { /* continue */ }
        }

        if (branchHint) {
          try {
            const content = await gitReadFileAtRef(projectDir, branchHint, relPath);
            setDocCache((prev) => ({ ...prev, [path]: content }));
            setDocSourceBranch((prev) => ({ ...prev, [path]: branchHint! }));
            setDocContentSource((prev) => ({ ...prev, [path]: 'git-show' }));
            return content;
          } catch { /* continue */ }
        }

        // Step 4: Scan all local branches
        const branches = await gitGetBranchStates(projectDir);
        for (const branch of branches) {
          if (branch.isCurrent) continue;
          try {
            const content = await gitReadFileAtRef(projectDir, branch.name, relPath);
            setDocCache((prev) => ({ ...prev, [path]: content }));
            setDocSourceBranch((prev) => ({ ...prev, [path]: branch.name }));
            setDocContentSource((prev) => ({ ...prev, [path]: 'git-show' }));
            return content;
          } catch { /* not on this branch */ }
        }
      } catch { /* branch scanning failed */ }

      // Step 5: Not found anywhere
      const fallback = '_Document not available_';
      setDocCache((prev) => ({ ...prev, [path]: fallback }));
      return fallback;
    } finally {
      setDocLoading(false);
    }
  }, [projectDir, projectId, isMigrated]);

  const getDocContent = useCallback(
    (path: string): string | undefined => docCache[path],
    [docCache],
  );

  const getSourceBranch = useCallback(
    (path: string): string | undefined => docSourceBranch[path],
    [docSourceBranch],
  );

  const getContentSource = useCallback(
    (path: string): 'local' | 'synced-snapshot' | 'git-show' | undefined => docContentSource[path],
    [docContentSource],
  );

  useEffect(() => {
    if (!item || !enrichedItem || !isTauriRuntime()) return;

    const docPaths = [enrichedItem.docs.spec, enrichedItem.docs.plan].filter(
      (path): path is string => Boolean(path),
    );
    if (docPaths.length === 0) return;

    const refreshPaths = (paths: string[]) => {
      paths.forEach((path) => {
        setDocCache((prev) => {
          const next = { ...prev };
          delete next[path];
          return next;
        });
        setDocSourceBranch((prev) => {
          const next = { ...prev };
          delete next[path];
          return next;
        });
        setDocContentSource((prev) => {
          const next = { ...prev };
          delete next[path];
          return next;
        });
        const docType = path === enrichedItem.docs.plan ? 'plan' : 'spec';
        void fetchDocContent(path, { itemId: item.id, docType });
      });
    };

    // Always refresh docs on open so modal reflects latest file changes,
    // even if no watcher event fired while it was closed.
    refreshPaths(docPaths);

    let unwatch: (() => void) | null = null;
    (async () => {
      try {
        const fs = await import('@tauri-apps/plugin-fs');
        unwatch = await fs.watch(docPaths, () => refreshPaths(docPaths), { delayMs: 200 });
      } catch (error) {
        console.warn('[RoadmapItemDialog] Failed to watch doc paths:', error);
      }
    })();

    return () => {
      if (unwatch) unwatch();
    };
  }, [item, enrichedItem, fetchDocContent]);

  if (!item || !enrichedItem) return null;

  const overlayClass = `${boardScoped ? 'absolute' : 'fixed'} inset-0 z-[60] flex items-center justify-center px-4 py-6`;
  const backdropClass = `absolute inset-0 bg-black/40 backdrop-blur-sm`;
  const dialogClass = `w-full ${boardScoped ? 'max-h-[calc(100%-3rem)]' : 'max-h-[90vh]'} max-w-6xl overflow-y-auto rounded-xl border border-neutral-200 bg-neutral-0 p-6 shadow-2xl dark:border-neutral-700 dark:bg-neutral-900 relative group z-10`;

  return (
    <div className={overlayClass}>
      {/* Backdrop */}
      <div
        className={backdropClass}
        onClick={onClose}
      />
      <ModalDragZone />

      {/* Dialog */}
      <div
        ref={dialogRef}
        className={dialogClass}
        role="dialog"
        aria-modal
        aria-label={`Roadmap item: ${item.title}`}
      >
        <div className="sticky top-0 z-10 flex justify-end gap-1">
          {onOpenChat && (
            <button
              type="button"
              className="rounded-md p-1 text-neutral-500 opacity-0 transition-opacity hover:bg-neutral-100 hover:text-neutral-800 group-hover:opacity-100 group-focus-within:opacity-100 group-hover:pointer-events-auto group-focus-within:pointer-events-auto pointer-events-none dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
              onClick={() => onOpenChat(item.id, item.title)}
              aria-label="Open chat"
            >
              <MessageSquare className="h-4 w-4" />
            </button>
          )}
          <button
            type="button"
            className="rounded-md p-1 text-neutral-500 opacity-0 transition-opacity hover:bg-neutral-100 hover:text-neutral-800 group-hover:opacity-100 group-focus-within:opacity-100 group-hover:pointer-events-auto group-focus-within:pointer-events-auto pointer-events-none dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
            onClick={onClose}
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <RoadmapItemDetail
          item={enrichedItem}
          projectTitle={projectTitle}
          onBack={onClose}
          onStatusChange={onStatusChange}
          fetchDocContent={fetchDocContent}
          getDocContent={getDocContent}
          getSourceBranch={getSourceBranch}
          getContentSource={getContentSource}
          docLoading={docLoading}
        />
      </div>
    </div>
  );
}
