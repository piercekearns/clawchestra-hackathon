import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { X } from 'lucide-react';
import { ModalDragZone } from '../ui/ModalDragZone';
import remarkGfm from 'remark-gfm';
import type { ProjectViewModel } from '../../lib/schema';
import { useProjectModal } from '../../hooks/useProjectModal';
import { ProjectModalHeader } from './ProjectModalHeader';
import { ProjectDetails } from './ProjectDetails';
import { RoadmapItemList } from './RoadmapItemList';
import { RoadmapItemDetail } from './RoadmapItemDetail';
import type { ProjectModalActions } from './types';

interface ProjectModalProps {
  project?: ProjectViewModel;
  open: boolean;
  onClose: () => void;
  actions: ProjectModalActions;
  boardScoped?: boolean;
}

export function ProjectModal({ project, open, onClose, actions, boardScoped }: ProjectModalProps) {
  const {
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
  } = useProjectModal(project, actions);

  const [completedExpanded, setCompletedExpanded] = useState(false);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();

      // Escape from detail view → back to list first
      if (modalView.kind === 'detail') {
        backToList();
        return;
      }

      onClose();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose, modalView, backToList]);

  if (!open || !project) return null;

  const hasRoadmap = project.hasRoadmap;

  const overlayClass = `${boardScoped ? 'absolute' : 'fixed'} inset-0 z-50 flex items-center justify-center bg-neutral-950/40 p-2 backdrop-blur-sm sm:p-4`;
  const dialogClass = `${boardScoped ? 'h-[min(90%,56rem)] max-h-[90%]' : 'h-[min(90vh,56rem)]'} w-full max-w-4xl overflow-y-auto rounded-2xl border border-neutral-200 bg-neutral-0 p-3 shadow-2xl dark:border-neutral-700 dark:bg-neutral-900 sm:p-5 relative group`;

  return (
    <div
      className={overlayClass}
      onClick={onClose}
    >
      <ModalDragZone />
      <div
        role="dialog"
        aria-modal="true"
        className={dialogClass}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex justify-end">
          <button
            type="button"
            className="rounded-md p-1 text-neutral-500 opacity-0 transition-opacity hover:bg-neutral-100 hover:text-neutral-800 group-hover:opacity-100 group-focus-within:opacity-100 group-hover:pointer-events-auto group-focus-within:pointer-events-auto pointer-events-none dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
            onClick={onClose}
            aria-label="Close modal"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <ProjectModalHeader
          project={project}
          localStatus={localStatus}
          onStatusChange={updateProjectStatus}
          onClose={onClose}
          showClose={false}
        />

        {/* Main content area */}
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
            ) : roadmapError ? (
              <div className="rounded-xl border border-status-danger/40 bg-status-danger/10 p-4 text-sm text-status-danger">
                {roadmapError}
              </div>
            ) : modalView.kind === 'detail' && selectedItem ? (
              <RoadmapItemDetail
                item={selectedItem}
                projectTitle={project.title}
                initialTab={modalView.initialDocTab}
                onBack={backToList}
                onStatusChange={updateRoadmapItemStatus}
                fetchDocContent={fetchDocContent}
                getDocContent={getDocContent}
                getSourceBranch={getSourceBranch}
                getContentSource={getContentSource}
                docLoading={docLoading}
              />
            ) : (
              <RoadmapItemList
                items={roadmapItems}
                onReorder={reorderRoadmapItems}
                onStatusChange={updateRoadmapItemStatus}
                onItemClick={(item) => openItemDetail(item.id)}
                onDocClick={(item, docType) => openItemDetail(item.id, docType)}
              />
            )}
          </div>
        ) : (
          <div className="prose mb-4 max-w-none rounded-xl border border-neutral-200 bg-neutral-50 p-4 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:prose-invert">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{project.content || '_No markdown content_'}</ReactMarkdown>
          </div>
        )}

        {/* Completed items (collapsible) */}
        {changelogEntries.length > 0 && (
          <div className="mb-4">
            <button
              type="button"
              onClick={() => setCompletedExpanded(!completedExpanded)}
              className="flex items-center gap-1.5 text-sm font-medium text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
            >
              <span className="text-xs">{completedExpanded ? '▾' : '▸'}</span>
              Completed ({changelogEntries.length})
            </button>
            {completedExpanded && (
              <div className="mt-2 space-y-1.5">
                {changelogEntries.map((entry) => (
                  <div
                    key={entry.id}
                    className="flex items-baseline gap-2 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800"
                  >
                    <span className="font-medium text-neutral-700 dark:text-neutral-200">
                      {entry.title}
                    </span>
                    <span className="text-xs text-neutral-400">
                      {entry.completedAt}
                    </span>
                    {entry.summary && (
                      <span className="text-xs text-neutral-500 dark:text-neutral-400">
                        — {entry.summary}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <ProjectDetails project={project} actions={actions} />
      </div>
    </div>
  );
}
