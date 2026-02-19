import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  ChangelogEntry,
  ProjectStatus,
  ProjectViewModel,
  RoadmapItemWithDocs,
  RoadmapStatus,
} from '../lib/schema';
import { readRoadmap, writeRoadmap, resolveDocFiles, enrichItemsWithDocs } from '../lib/roadmap';
import { migrateCompletedItem } from '../lib/changelog';
import { parseChangelog } from '../lib/changelog';
import { readFile } from '../lib/tauri';
import type { ProjectModalActions } from '../components/modal/types';
import { autoCommitIfLocalOnly } from '../lib/auto-commit';

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
  fetchDocContent: (path: string) => Promise<string>;
  getDocContent: (path: string) => string | undefined;
  docLoading: boolean;
}

export function useProjectModal(
  project: ProjectViewModel | undefined,
  actions: ProjectModalActions,
): UseProjectModalReturn {
  const [localStatus, setLocalStatus] = useState<ProjectStatus>('up-next');
  const [roadmapItems, setRoadmapItems] = useState<RoadmapItemWithDocs[]>([]);
  const [roadmapLoading, setRoadmapLoading] = useState(false);
  const [roadmapFilePath, setRoadmapFilePath] = useState<string | null>(null);
  const [roadmapNotes, setRoadmapNotes] = useState('');
  const [roadmapError, setRoadmapError] = useState<string | null>(null);
  const [modalView, setModalView] = useState<ModalView>({ kind: 'list' });
  const [docContentCache, setDocContentCache] = useState<Record<string, string>>({});
  const [docLoading, setDocLoading] = useState(false);
  const [changelogEntries, setChangelogEntries] = useState<ChangelogEntry[]>([]);

  // Sync local status from project prop
  useEffect(() => {
    if (!project) return;
    setLocalStatus(project.status as ProjectStatus);
  }, [project]);

  // Reset view and cache when project changes
  useEffect(() => {
    setModalView({ kind: 'list' });
    setDocContentCache({});
  }, [project?.id]);

  // Load roadmap when project changes
  useEffect(() => {
    if (!project?.hasRoadmap || !project.roadmapFilePath) {
      setRoadmapItems([]);
      setRoadmapFilePath(null);
      setRoadmapNotes('');
      setRoadmapError(null);
      return;
    }

    let cancelled = false;
    setRoadmapLoading(true);
    setRoadmapError(null);

    const load = async () => {
      try {
        const roadmap = await readRoadmap(project.roadmapFilePath!);
        if (cancelled) return;

        setRoadmapFilePath(roadmap.filePath);
        setRoadmapNotes(roadmap.notes);

        const dirPath = project.dirPath;
        if (dirPath) {
          const docsMap = await resolveDocFiles(dirPath, roadmap.items, project.frontmatter);
          if (cancelled) return;
          setRoadmapItems(enrichItemsWithDocs(roadmap.items, docsMap));
        } else {
          setRoadmapItems(roadmap.items.map((item) => ({ ...item, docs: {} })));
        }
      } catch (error) {
        if (!cancelled) {
          setRoadmapItems([]);
          setRoadmapError(
            error instanceof Error ? error.message : 'Could not load roadmap',
          );
        }
      } finally {
        if (!cancelled) setRoadmapLoading(false);
      }
    };

    void load();
    return () => { cancelled = true; };
  }, [project?.id, project?.hasRoadmap, project?.roadmapFilePath]);

  // Load changelog when project changes
  useEffect(() => {
    if (!project?.hasChangelog || !project.changelogFilePath) {
      setChangelogEntries([]);
      return;
    }

    let cancelled = false;

    const load = async () => {
      try {
        const changelog = await parseChangelog(project.changelogFilePath!);
        if (!cancelled) setChangelogEntries(changelog.entries);
      } catch {
        if (!cancelled) setChangelogEntries([]);
      }
    };

    void load();
    return () => { cancelled = true; };
  }, [project?.id, project?.hasChangelog, project?.changelogFilePath]);

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

  const persistRoadmap = useCallback(
    async (items: RoadmapItemWithDocs[]) => {
      if (!roadmapFilePath) return;
      const normalized = items.map((item, index) => ({
        id: item.id,
        title: item.title,
        status: item.status,
        priority: index + 1,
        nextAction: item.nextAction,
        blockedBy: item.blockedBy,
        tags: item.tags,
        icon: item.icon,
      }));
      await writeRoadmap({ filePath: roadmapFilePath, items: normalized, notes: roadmapNotes });
    },
    [roadmapFilePath, roadmapNotes],
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
      // If marking as complete, trigger changelog migration
      if (status === 'complete' && roadmapFilePath && project?.changelogFilePath) {
        const previous = roadmapItems;

        // Optimistic: remove from list immediately
        setRoadmapItems(roadmapItems.filter((item) => item.id !== itemId));

        void migrateCompletedItem(roadmapFilePath, project.changelogFilePath, itemId)
          .then(async () => {
            // Auto-commit for local-only repos
            if (project.hasRepo && !project.gitStatus?.remote) {
              void autoCommitIfLocalOnly(
                project.dirPath,
                project.gitStatus,
                ['ROADMAP.md', 'CHANGELOG.md'],
              );
            }
            // Refresh changelog entries
            try {
              const changelog = await parseChangelog(project.changelogFilePath!);
              setChangelogEntries(changelog.entries);
            } catch {
              // Best effort
            }
          })
          .catch(() => {
            setRoadmapItems(previous);
          });
        return;
      }

      const previous = roadmapItems;
      const updated = roadmapItems.map((item) =>
        item.id === itemId ? { ...item, status } : item,
      );
      setRoadmapItems(updated);

      void persistRoadmap(updated).catch(() => {
        setRoadmapItems(previous);
      });
    },
    [roadmapItems, persistRoadmap, roadmapFilePath, project?.changelogFilePath],
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

  // Doc content fetching with cache
  const fetchDocContent = useCallback(
    async (path: string): Promise<string> => {
      if (docContentCache[path] !== undefined) return docContentCache[path];

      setDocLoading(true);
      try {
        const content = await readFile(path);
        setDocContentCache((prev) => ({ ...prev, [path]: content }));
        return content;
      } catch {
        const fallback = '_Could not load document_';
        setDocContentCache((prev) => ({ ...prev, [path]: fallback }));
        return fallback;
      } finally {
        setDocLoading(false);
      }
    },
    [docContentCache],
  );

  const getDocContent = useCallback(
    (path: string): string | undefined => docContentCache[path],
    [docContentCache],
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
    docLoading,
  };
}
