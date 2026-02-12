import { useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import type { ProjectViewModel } from '../../lib/schema';
import { useProjectModal } from '../../hooks/useProjectModal';
import { ProjectModalHeader } from './ProjectModalHeader';
import { ProjectDetails } from './ProjectDetails';
import type { ProjectModalActions } from './types';

interface ProjectModalProps {
  project?: ProjectViewModel;
  open: boolean;
  onClose: () => void;
  actions: ProjectModalActions;
}

export function ProjectModal({ project, open, onClose, actions }: ProjectModalProps) {
  const { localStatus, updateProjectStatus } = useProjectModal(project, actions);

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

        {/* Main content: roadmap items (later phases) or markdown for non-roadmap projects */}
        <div className="prose max-w-none rounded-xl border border-neutral-200 bg-neutral-50 p-4 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:prose-invert">
          <ReactMarkdown>{project.content || '_No markdown content_'}</ReactMarkdown>
        </div>

        <ProjectDetails project={project} actions={actions} />
      </div>
    </div>
  );
}
