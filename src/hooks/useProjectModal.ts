import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  ProjectStatus,
  ProjectViewModel,
  RoadmapItemWithDocs,
  RoadmapStatus,
} from '../lib/schema';
import { readRoadmap, writeRoadmap, resolveDocFiles, enrichItemsWithDocs } from '../lib/roadmap';
import type { ProjectModalActions } from '../components/modal/types';

interface UseProjectModalReturn {
  localStatus: ProjectStatus;
  updateProjectStatus: (next: ProjectStatus) => void;
  roadmapItems: RoadmapItemWithDocs[];
  roadmapLoading: boolean;
  reorderRoadmapItems: (items: RoadmapItemWithDocs[]) => void;
  updateRoadmapItemStatus: (itemId: string, status: RoadmapStatus) => void;
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

  // Sync local status from project prop
  useEffect(() => {
    if (!project) return;
    setLocalStatus(project.status as ProjectStatus);
  }, [project]);

  // Load roadmap when project changes
  useEffect(() => {
    if (!project?.hasRoadmap || !project.roadmapFilePath) {
      setRoadmapItems([]);
      setRoadmapFilePath(null);
      setRoadmapNotes('');
      return;
    }

    let cancelled = false;
    setRoadmapLoading(true);

    const load = async () => {
      try {
        const roadmap = await readRoadmap(project.roadmapFilePath!);
        if (cancelled) return;

        setRoadmapFilePath(roadmap.filePath);
        setRoadmapNotes(roadmap.notes);

        const localPath = project.frontmatter.localPath;
        if (localPath) {
          const docsMap = await resolveDocFiles(localPath, roadmap.items, project.frontmatter);
          if (cancelled) return;
          setRoadmapItems(enrichItemsWithDocs(roadmap.items, docsMap));
        } else {
          setRoadmapItems(roadmap.items.map((item) => ({ ...item, docs: {} })));
        }
      } catch {
        if (!cancelled) setRoadmapItems([]);
      } finally {
        if (!cancelled) setRoadmapLoading(false);
      }
    };

    void load();
    return () => { cancelled = true; };
  }, [project?.id, project?.hasRoadmap, project?.roadmapFilePath]);

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
      const previous = roadmapItems;
      const updated = roadmapItems.map((item) =>
        item.id === itemId ? { ...item, status } : item,
      );
      setRoadmapItems(updated);

      void persistRoadmap(updated).catch(() => {
        setRoadmapItems(previous);
      });
    },
    [roadmapItems, persistRoadmap],
  );

  return {
    localStatus,
    updateProjectStatus,
    roadmapItems,
    roadmapLoading,
    reorderRoadmapItems,
    updateRoadmapItemStatus,
  };
}
