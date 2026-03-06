import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  ChangelogEntry,
  ProjectStatus,
  ProjectViewModel,
  RoadmapItemWithDocs,
  RoadmapStatus,
} from '../lib/schema';
import { resolveDocFiles, enrichItemsWithDocs } from '../lib/doc-resolution';
import {
  batchReorderItems,
  readFile,
  gitReadFileAtRef,
  gitGetBranchStates,
  updateRoadmapItem,
  getProject,
} from '../lib/tauri';
import { useDashboardStore } from '../lib/store';
import { mapToRoadmapItemsWithDocs } from '../lib/roadmap-item-mapper';
import type { ProjectModalActions } from '../components/modal/types';

type ModalView =
  | { kind: 'list' }
  | { kind: 'detail'; itemId: string; initialDocTab?: 'spec' | 'plan' };

interface UseProjectModalReturn {
  localStatus: ProjectStatus;
  updateProjectStatus: (next: ProjectStatus) => void;
  roadmapItems: RoadmapItemWithDocs[];
  roadmapLoading: boolean;
  roadmapError: string | null;
  reorderRoadmapItems: (items: RoadmapItemWithDocs[]) => void;
  updateRoadmapItemStatus: (itemId: string, status: RoadmapStatus) => void;
  changelogEntries: ChangelogEntry[];
  modalView: ModalView;
  selectedItem: RoadmapItemWithDocs | undefined;
  openItemDetail: (itemId: string, initialDocTab?: 'spec' | 'plan') => void;
  backToList: () => void;
  fetchDocContent: (path: string, opts?: { itemId?: string; docType?: 'spec' | 'plan' }) => Promise<string>;
  getDocContent: (path: string) => string | undefined;
  getSourceBranch: (path: string) => string | undefined;
  getContentSource: (path: string) => 'local' | 'synced-snapshot' | 'git-show' | undefined;
  docLoading: boolean;
}

export function useProjectModal(
  project: ProjectViewModel | undefined,
  actions: ProjectModalActions,
): UseProjectModalReturn {
  const [localStatus, setLocalStatus] = useState<ProjectStatus>('up-next');
  const [roadmapItems, setRoadmapItems] = useState<RoadmapItemWithDocs[]>([]);
  const [roadmapLoading, setRoadmapLoading] = useState(false);
  const [roadmapError, setRoadmapError] = useState<string | null>(null);
  const [modalView, setModalView] = useState<ModalView>({ kind: 'list' });
  const [docContentCache, setDocContentCache] = useState<Record<string, string>>({});
  const [docSourceBranch, setDocSourceBranch] = useState<Record<string, string>>({});
  const [docContentSource, setDocContentSource] = useState<Record<string, 'local' | 'synced-snapshot' | 'git-show'>>({});
  const [docLoading, setDocLoading] = useState(false);
  const [changelogEntries, setChangelogEntries] = useState<ChangelogEntry[]>([]);

  // Zustand store — roadmap items from db.json (migrated projects only)
  const storeRoadmapItems = useDashboardStore((state) => state.roadmapItems);

  // Sync local status from project prop
  useEffect(() => {
    if (!project) return;
    setLocalStatus(project.status as ProjectStatus);
  }, [project]);

  // Reset view and cache when project changes
  useEffect(() => {
    setModalView({ kind: 'list' });
    setDocContentCache({});
    setDocSourceBranch({});
    setDocContentSource({});
  }, [project?.id]);

  // Load roadmap when project changes
  useEffect(() => {
    if (!project) {
      setRoadmapItems([]);
      setRoadmapError(null);
      return;
    }

    const items = storeRoadmapItems[project.id] || [];
    const mapped = mapToRoadmapItemsWithDocs(items);

    let cancelled = false;
    setRoadmapLoading(true);
    setRoadmapError(null);

    const resolveAndSet = async () => {
      try {
        if (project.dirPath && mapped.length > 0) {
          const docsMap = await resolveDocFiles(project.dirPath, mapped, project.frontmatter);
          if (cancelled) return;
          setRoadmapItems(enrichItemsWithDocs(mapped, docsMap));
        } else {
          if (cancelled) return;
          setRoadmapItems(mapped);
        }
      } catch {
        if (!cancelled) setRoadmapItems(mapped);
      } finally {
        if (!cancelled) setRoadmapLoading(false);
      }
    };

    void resolveAndSet();
    return () => { cancelled = true; };
  }, [project?.id, project?.dirPath, project?.frontmatter, storeRoadmapItems]);

  // Completed roadmap entries from db.json (post-migration canonical source).
  useEffect(() => {
    if (!project) {
      setChangelogEntries([]);
      return;
    }

    const items = storeRoadmapItems[project.id] || [];
    const completed = items
      .filter((item) => item.status === 'complete')
      .map<ChangelogEntry>((item) => ({
        id: item.id,
        title: item.title,
        completedAt: item.completedAt ?? '',
      }))
      .sort((a, b) => b.completedAt.localeCompare(a.completedAt));
    setChangelogEntries(completed);
  }, [project, storeRoadmapItems]);

  const updateProjectStatus = useCallback(
    (next: ProjectStatus) => {
      if (!project) return;
      const previous = localStatus;
      setLocalStatus(next);

      void actions.onSave(project, { status: next }).catch(() => {
        setLocalStatus(previous);
      });
    },
    [project, localStatus, actions],
  );

  // Persist roadmap changes through the db/state.json command path.
  const persistRoadmap = useCallback(
    async (items: RoadmapItemWithDocs[]) => {
      if (!project) return;
      await batchReorderItems(
        project.id,
        items.map((item, index) => ({
          itemId: item.id,
          newPriority: index + 1,
          newStatus: item.status,
        })),
      );
    },
    [project],
  );

  const reorderRoadmapItems = useCallback(
    (newItems: RoadmapItemWithDocs[]) => {
      const previous = roadmapItems;
      setRoadmapItems(newItems);

      void persistRoadmap(newItems).catch(() => {
        setRoadmapItems(previous);
      });
    },
    [roadmapItems, persistRoadmap],
  );

  const updateRoadmapItemStatus = useCallback(
    (itemId: string, status: RoadmapStatus) => {
      if (!project) return;
      const previous = roadmapItems;

      if (status === 'complete') {
        const today = new Date().toISOString().split('T')[0];
        setRoadmapItems(roadmapItems.filter((item) => item.id !== itemId));

        void updateRoadmapItem(project.id, itemId, {
          status: 'complete',
          completedAt: today,
        }).catch(() => {
          setRoadmapItems(previous);
        });
        return;
      }

      const updated = roadmapItems.map((item) =>
        item.id === itemId ? { ...item, status } : item,
      );
      setRoadmapItems(updated);

      void updateRoadmapItem(project.id, itemId, { status }).catch(() => {
        setRoadmapItems(previous);
      });
    },
    [project, roadmapItems],
  );

  // View navigation
  const openItemDetail = useCallback(
    (itemId: string, initialDocTab?: 'spec' | 'plan') => {
      setModalView({ kind: 'detail', itemId, initialDocTab });
    },
    [],
  );

  const backToList = useCallback(() => {
    setModalView({ kind: 'list' });
  }, []);

  const selectedItem = useMemo(() => {
    if (modalView.kind !== 'detail') return undefined;
    return roadmapItems.find((item) => item.id === modalView.itemId);
  }, [modalView, roadmapItems]);

  // Doc content fetching — Phase 5.21.3 priority chain:
  // 1. readFile (local working tree) → 2. db.json content field (synced snapshot) →
  // 3. git show with branch hint → 4. scan all branches → 5. "not available"
  const fetchDocContent = useCallback(
    async (path: string, opts?: { itemId?: string; docType?: 'spec' | 'plan' }): Promise<string> => {
      if (docContentCache[path] !== undefined) return docContentCache[path];

      const repoPath = project?.dirPath;
      const projectId = project?.id;
      setDocLoading(true);
      try {
        // Step 1: Try reading from the working tree (happy path — local file is authoritative)
        const content = await readFile(path);
        setDocContentCache((prev) => ({ ...prev, [path]: content }));
        setDocContentSource((prev) => ({ ...prev, [path]: 'local' }));
        return content;
      } catch {
        // Step 2: Try db.json content field (synced snapshot from another device/branch)
        if (projectId && opts?.itemId && opts?.docType && project?.stateJsonMigrated) {
          try {
            const detail = await getProject(projectId);
            const dbItem = detail.roadmapItems.find((ri) => ri.id === opts.itemId);
            const contentField = opts.docType === 'spec' ? dbItem?.specDocContent : dbItem?.planDocContent;
            if (contentField) {
              setDocContentCache((prev) => ({ ...prev, [path]: contentField }));
              setDocContentSource((prev) => ({ ...prev, [path]: 'synced-snapshot' }));
              // Also store branch hint from the db item if available
              const branchField = opts.docType === 'spec' ? dbItem?.specDocBranch : dbItem?.planDocBranch;
              if (branchField) {
                setDocSourceBranch((prev) => ({ ...prev, [path]: branchField }));
              }
              return contentField;
            }
          } catch {
            // get_project failed, continue to git show fallback
          }
        }

        // Step 3+4: git show fallback (needs repo path)
        if (!repoPath) {
          const fallback = '_Document not available_';
          setDocContentCache((prev) => ({ ...prev, [path]: fallback }));
          return fallback;
        }

        const relPath = path.startsWith(repoPath)
          ? path.slice(repoPath.length).replace(/^\//, '')
          : path;

        // Step 3: Try branch hint from db.json (specDocBranch/planDocBranch)
        try {
          let branchHint: string | undefined;
          if (projectId && opts?.itemId && opts?.docType && project?.stateJsonMigrated) {
            try {
              const detail = await getProject(projectId);
              const dbItem = detail.roadmapItems.find((ri) => ri.id === opts.itemId);
              branchHint = opts.docType === 'spec' ? dbItem?.specDocBranch : dbItem?.planDocBranch;
            } catch {
              // Failed to get branch hint, continue
            }
          }

          if (branchHint) {
            try {
              const content = await gitReadFileAtRef(repoPath, branchHint, relPath);
              setDocContentCache((prev) => ({ ...prev, [path]: content }));
              setDocSourceBranch((prev) => ({ ...prev, [path]: branchHint! }));
              setDocContentSource((prev) => ({ ...prev, [path]: 'git-show' }));
              return content;
            } catch {
              // Branch hint failed, continue to scan
            }
          }

          // Step 4: Scan all local branches
          const branches = await gitGetBranchStates(repoPath);
          for (const branch of branches) {
            if (branch.isCurrent) continue;
            try {
              const content = await gitReadFileAtRef(repoPath, branch.name, relPath);
              setDocContentCache((prev) => ({ ...prev, [path]: content }));
              setDocSourceBranch((prev) => ({ ...prev, [path]: branch.name }));
              setDocContentSource((prev) => ({ ...prev, [path]: 'git-show' }));
              return content;
            } catch {
              // Not on this branch, try next
            }
          }
        } catch {
          // Branch scanning failed entirely
        }

        // Step 5: Not found anywhere
        const fallback = '_Document not available_';
        setDocContentCache((prev) => ({ ...prev, [path]: fallback }));
        return fallback;
      } finally {
        setDocLoading(false);
      }
    },
    [docContentCache, project?.dirPath, project?.id, project?.stateJsonMigrated],
  );

  const getDocContent = useCallback(
    (path: string): string | undefined => docContentCache[path],
    [docContentCache],
  );

  const getSourceBranch = useCallback(
    (path: string): string | undefined => docSourceBranch[path],
    [docSourceBranch],
  );

  const getContentSource = useCallback(
    (path: string): 'local' | 'synced-snapshot' | 'git-show' | undefined => docContentSource[path],
    [docContentSource],
  );

  return {
    localStatus,
    updateProjectStatus,
    roadmapItems,
    roadmapLoading,
    roadmapError,
    reorderRoadmapItems,
    updateRoadmapItemStatus,
    changelogEntries,
    modalView,
    selectedItem,
    openItemDetail,
    backToList,
    fetchDocContent,
    getDocContent,
    getSourceBranch,
    getContentSource,
    docLoading,
  };
}
