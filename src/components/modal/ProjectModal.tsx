import { useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import type { ProjectViewModel } from '../../lib/schema';
import { useProjectModal } from '../../hooks/useProjectModal';
import { ProjectModalHeader } from './ProjectModalHeader';
import { ProjectDetails } from './ProjectDetails';
import { RoadmapItemList } from './RoadmapItemList';
import type { ProjectModalActions } from './types';

interface ProjectModalProps {
  project?: ProjectViewModel;
  open: boolean;
  onClose: () => void;
  actions: ProjectModalActions;
}

export function ProjectModal({ project, open, onClose, actions }: ProjectModalProps) {
  const {
    localStatus,
    updateProjectStatus,
    roadmapItems,
    roadmapLoading,
    reorderRoadmapItems,
    updateRoadmapItemStatus,
  } = useProjectModal(project, actions);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open || !project) return null;

  const hasRoadmap = project.hasRoadmap;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/40 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="h-[min(90vh,56rem)] w-full max-w-4xl overflow-y-auto rounded-2xl border border-neutral-200 bg-neutral-0 p-5 shadow-2xl dark:border-neutral-700 dark:bg-neutral-900"
        onClick={(event) => event.stopPropagation()}
      >
        <ProjectModalHeader
          project={project}
          localStatus={localStatus}
          onStatusChange={updateProjectStatus}
          onClose={onClose}
        />

        {/* Main content: roadmap list or markdown */}
        {hasRoadmap ? (
          <div className="mb-4">
            {roadmapLoading ? (
              <div className="flex flex-col gap-2">
                {[1, 2, 3].map((n) => (
                  <div
                    key={n}
                    className="h-10 animate-pulse rounded-lg bg-neutral-200 dark:bg-neutral-700"
                  />
                ))}
              </div>
            ) : (
              <RoadmapItemList
                items={roadmapItems}
                onReorder={reorderRoadmapItems}
                onStatusChange={updateRoadmapItemStatus}
                onItemClick={() => {/* Phase 4: navigate to detail view */}}
                onDocClick={() => {/* Phase 4: navigate to detail with doc tab */}}
              />
            )}
          </div>
        ) : (
          <div className="prose mb-4 max-w-none rounded-xl border border-neutral-200 bg-neutral-50 p-4 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:prose-invert">
            <ReactMarkdown>{project.content || '_No markdown content_'}</ReactMarkdown>
          </div>
        )}

        <ProjectDetails project={project} actions={actions} />
      </div>
    </div>
  );
}
