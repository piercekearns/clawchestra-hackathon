import { useCallback, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { ModalDragZone } from '../ui/ModalDragZone';
import type { ProjectFrontmatter, RoadmapItem, RoadmapItemWithDocs, RoadmapStatus } from '../../lib/schema';
import { resolveDocFiles, enrichItemsWithDocs } from '../../lib/roadmap';
import { readFile, gitReadFileAtRef, gitGetBranchStates } from '../../lib/tauri';
import { RoadmapItemDetail } from './RoadmapItemDetail';

interface RoadmapItemDialogProps {
  item: RoadmapItem | null;
  projectTitle: string;
  projectDir: string;
  projectFrontmatter?: ProjectFrontmatter;
  onClose: () => void;
  onStatusChange: (itemId: string, status: RoadmapStatus) => void;
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
  onClose,
  onStatusChange,
}: RoadmapItemDialogProps) {
  const [enrichedItem, setEnrichedItem] = useState<RoadmapItemWithDocs | null>(null);
  const [docCache, setDocCache] = useState<Record<string, string>>({});
  const [docSourceBranch, setDocSourceBranch] = useState<Record<string, string>>({});
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

  const fetchDocContent = useCallback(async (path: string): Promise<string> => {
    setDocLoading(true);
    try {
      const content = await readFile(path);
      setDocCache((prev) => ({ ...prev, [path]: content }));
      return content;
    } catch {
      // File not on current branch — try git show fallback
      const relPath = path.startsWith(projectDir)
        ? path.slice(projectDir.length).replace(/^\//, '')
        : path;

      try {
        const branches = await gitGetBranchStates(projectDir);
        for (const branch of branches) {
          if (branch.isCurrent) continue;
          try {
            const content = await gitReadFileAtRef(projectDir, branch.name, relPath);
            setDocCache((prev) => ({ ...prev, [path]: content }));
            setDocSourceBranch((prev) => ({ ...prev, [path]: branch.name }));
            return content;
          } catch {
            // Not on this branch
          }
        }
      } catch {
        // Branch scanning failed
      }

      const fallback = '_Document not found on any branch_';
      setDocCache((prev) => ({ ...prev, [path]: fallback }));
      return fallback;
    } finally {
      setDocLoading(false);
    }
  }, [projectDir]);

  const getDocContent = useCallback(
    (path: string): string | undefined => docCache[path],
    [docCache],
  );

  const getSourceBranch = useCallback(
    (path: string): string | undefined => docSourceBranch[path],
    [docSourceBranch],
  );

  if (!item || !enrichedItem) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />
      <ModalDragZone />

      {/* Dialog */}
      <div
        ref={dialogRef}
        className="fixed inset-x-4 top-[5%] z-50 mx-auto max-h-[90vh] max-w-6xl overflow-y-auto rounded-xl border border-neutral-200 bg-neutral-0 p-6 shadow-2xl dark:border-neutral-700 dark:bg-neutral-900"
        role="dialog"
        aria-modal
        aria-label={`Roadmap item: ${item.title}`}
      >
        <button
          type="button"
          className="absolute right-3 top-3 rounded-md p-1 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
          onClick={onClose}
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>

        <RoadmapItemDetail
          item={enrichedItem}
          projectTitle={projectTitle}
          onBack={onClose}
          onStatusChange={onStatusChange}
          fetchDocContent={fetchDocContent}
          getDocContent={getDocContent}
          getSourceBranch={getSourceBranch}
          docLoading={docLoading}
        />
      </div>
    </>
  );
}
