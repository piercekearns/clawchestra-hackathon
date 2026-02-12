import { useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import type { ProjectStatus, ProjectViewModel } from '../../lib/schema';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { useProjectModal } from '../../hooks/useProjectModal';
import { ProjectModalHeader } from './ProjectModalHeader';
import type { ProjectModalActions } from './types';

interface ProjectModalProps {
  project?: ProjectViewModel;
  open: boolean;
  onClose: () => void;
  actions: ProjectModalActions;
}

export function ProjectModal({ project, open, onClose, actions }: ProjectModalProps) {
  const { localStatus, updateProjectStatus } = useProjectModal(project, actions);

  const [priority, setPriority] = useState('');
  const [nextAction, setNextAction] = useState('');
  const [blockedBy, setBlockedBy] = useState('');
  const [tags, setTags] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!project) return;
    setPriority(project.frontmatter.priority ? String(project.frontmatter.priority) : '');
    setNextAction(project.nextAction ?? '');
    setBlockedBy(project.blockedBy ?? '');
    setTags(project.tags?.join(', ') ?? '');
  }, [project]);

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

  const tagList = useMemo(
    () => tags.split(',').map((tag) => tag.trim()).filter(Boolean),
    [tags],
  );

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

        {/* Temporary: existing form body — will be replaced by RoadmapItemList + ProjectDetails in later phases */}
        <div className="grid gap-3 rounded-xl border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-700 dark:bg-neutral-800">
          <label className="grid gap-1 text-sm">
            <span>Priority</span>
            <Input
              value={priority}
              onChange={(event) => setPriority(event.target.value)}
              placeholder="Optional number"
            />
          </label>

          <label className="grid gap-1 text-sm">
            <span>Next Action</span>
            <Input
              value={nextAction}
              onChange={(event) => setNextAction(event.target.value)}
              placeholder="What should happen next?"
            />
          </label>

          <label className="grid gap-1 text-sm">
            <span>Blocked By</span>
            <Input
              value={blockedBy}
              onChange={(event) => setBlockedBy(event.target.value)}
              placeholder="Dependency or blocker"
            />
          </label>

          <label className="grid gap-1 text-sm">
            <span>Tags (comma separated)</span>
            <Input
              value={tags}
              onChange={(event) => setTags(event.target.value)}
              placeholder="frontend, platform"
            />
          </label>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button
              type="button"
              onClick={async () => {
                setSaving(true);
                try {
                  await actions.onSave(project, {
                    status: localStatus,
                    priority: priority.trim() ? Number(priority) : null,
                    nextAction: nextAction.trim() ? nextAction : null,
                    blockedBy: blockedBy.trim() ? blockedBy : null,
                    tags: tagList.length ? tagList : null,
                  });
                } finally {
                  setSaving(false);
                }
              }}
              disabled={saving}
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </Button>

            <Button
              type="button"
              onClick={async () => {
                setDeleting(true);
                try {
                  await actions.onDelete(project);
                  onClose();
                } finally {
                  setDeleting(false);
                }
              }}
              variant="destructive"
              disabled={deleting}
            >
              {deleting ? 'Deleting...' : 'Delete'}
            </Button>

            <Button
              type="button"
              variant="secondary"
              onClick={() => void actions.onMarkReviewed(project)}
            >
              Mark Reviewed
            </Button>

            <Button
              type="button"
              variant="outline"
              onClick={() => void actions.onRequestUpdate(project)}
            >
              Request Update
            </Button>

            {project.frontmatter.localPath && (
              <Button
                type="button"
                variant="secondary"
                onClick={() => void actions.onCommitRepo(project)}
              >
                Commit Planning Docs
              </Button>
            )}

            {project.frontmatter.localPath && (
              <Button
                type="button"
                variant="secondary"
                onClick={() => void actions.onPushRepo(project)}
              >
                Push Repo
              </Button>
            )}
          </div>
        </div>

        <div className="mt-4 grid gap-1 rounded-xl border border-neutral-200 bg-neutral-50 p-4 text-xs dark:border-neutral-700 dark:bg-neutral-800">
          <p><strong>Dashboard file:</strong> {project.filePath}</p>
          {project.repoFilePath && <p><strong>Repo file:</strong> {project.repoFilePath}</p>}
          {project.frontmatter.parent && (
            <p><strong>Parent:</strong> {project.frontmatter.parent}</p>
          )}
          <div className="mt-1 flex flex-wrap gap-2">
            <Badge variant={project.hasRepo ? 'success' : 'outline'}>
              {project.hasRepo ? 'Repo-linked project' : 'Dashboard-only project'}
            </Badge>
            {project.children.length > 0 && (
              <Badge variant="accent">{project.children.length} sub-project(s)</Badge>
            )}
            {project.hasRoadmap && <Badge variant="accent">Roadmap available</Badge>}
            {project.gitStatus && (
              <Badge variant="outline">
                Git: {project.gitStatus.state}
                {project.gitStatus.branch ? ` (${project.gitStatus.branch})` : ''}
              </Badge>
            )}
            {project.commitActivity && (
              <Badge variant="outline">
                GitHub: {project.commitActivity.commitsThisWeek} commit(s)/week
              </Badge>
            )}
          </div>
        </div>

        {project.children.length > 0 && (
          <div className="mt-4 rounded-xl border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-700 dark:bg-neutral-800">
            <h3 className="mb-2 text-sm font-semibold">Sub-projects</h3>
            <div className="flex flex-wrap gap-2">
              {project.children.map((child) => (
                <Button
                  key={child.id}
                  variant="secondary"
                  size="sm"
                  onClick={() => actions.onOpenLinkedProject(child.id)}
                >
                  {child.icon ? `${child.icon} ` : ''}
                  {child.title}
                </Button>
              ))}
            </div>
          </div>
        )}

        {project.frontmatter.parent && (
          <div className="mt-4 rounded-xl border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-700 dark:bg-neutral-800">
            <h3 className="mb-2 text-sm font-semibold">Linked parent</h3>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => actions.onOpenLinkedProject(project.frontmatter.parent ?? '')}
            >
              {project.frontmatter.parent}
            </Button>
          </div>
        )}

        <div className="prose mt-4 max-w-none rounded-xl border border-neutral-200 bg-neutral-50 p-4 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:prose-invert">
          <ReactMarkdown>{project.content || '_No markdown content_'}</ReactMarkdown>
        </div>
      </div>
    </div>
  );
}
