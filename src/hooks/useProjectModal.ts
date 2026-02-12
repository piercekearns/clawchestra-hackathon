import { useCallback, useEffect, useState } from 'react';
import type { ProjectStatus, ProjectViewModel } from '../lib/schema';
import type { ProjectModalActions } from '../components/modal/types';

interface UseProjectModalReturn {
  localStatus: ProjectStatus;
  updateProjectStatus: (next: ProjectStatus) => void;
}

export function useProjectModal(
  project: ProjectViewModel | undefined,
  actions: ProjectModalActions,
): UseProjectModalReturn {
  const [localStatus, setLocalStatus] = useState<ProjectStatus>('up-next');

  // Sync local status from project prop
  useEffect(() => {
    if (!project) return;
    setLocalStatus(project.status as ProjectStatus);
  }, [project]);

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

  return {
    localStatus,
    updateProjectStatus,
  };
}
