import { useEffect, useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import type { ProjectStatus, ProjectViewModel } from '../lib/schema';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Input } from './ui/input';

interface CardDetailProps {
  project?: ProjectViewModel;
  open: boolean;
  onClose: () => void;
  onOpenLinkedProject?: (projectId: string) => void;
  onViewRoadmap?: (project: ProjectViewModel) => Promise<void>;
  onMarkReviewed?: (project: ProjectViewModel) => Promise<void>;
  onRequestUpdate?: (project: ProjectViewModel) => Promise<void>;
  onCommitRepo?: (project: ProjectViewModel) => Promise<void>;
  onPushRepo?: (project: ProjectViewModel) => Promise<void>;
  onSave: (
    project: ProjectViewModel,
    updates: {
      status?: ProjectStatus;
      priority?: number | null;
      tags?: string[] | null;
      nextAction?: string | null;
      blockedBy?: string | null;
      lastReviewed?: string | null;
    },
  ) => Promise<void>;
  onDelete: (project: ProjectViewModel) => Promise<void>;
}

const STATUSES: ProjectStatus[] = ['in-flight', 'up-next', 'simmering', 'dormant', 'shipped'];

export function CardDetail({
  project,
  open,
  onClose,
  onOpenLinkedProject,
  onViewRoadmap,
  onMarkReviewed,
  onRequestUpdate,
  onCommitRepo,
  onPushRepo,
  onSave,
  onDelete,
}: CardDetailProps) {
  const [status, setStatus] = useState<ProjectStatus>('up-next');
  const [priority, setPriority] = useState<string>('');
  const [nextAction, setNextAction] = useState('');
  const [blockedBy, setBlockedBy] = useState('');
  const [tags, setTags] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!project) return;
    setStatus(project.status as ProjectStatus);
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
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <p className="mb-1 text-[11px] uppercase tracking-[0.08em] text-neutral-500">Project Detail</p>
            <h2 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">{project.title}</h2>
            <p className="mt-1 text-xs text-neutral-500">{project.id}</p>
          </div>
          <button
            type="button"
            className="rounded-lg border border-neutral-300 px-3 py-1 text-sm dark:border-neutral-600"
            onClick={onClose}
          >
            Close
          </button>
        </div>

        <div className="grid gap-3 rounded-xl border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-700 dark:bg-neutral-800">
          <label className="grid gap-1 text-sm">
            <span>Status</span>
            <div className="relative">
              <select
                className="h-10 w-full appearance-none rounded-lg border border-neutral-300 bg-neutral-50 px-3 pr-9 text-sm text-neutral-800 shadow-none outline-none transition-colors hover:border-neutral-400 focus:border-revival-accent-400 focus:ring-2 focus:ring-revival-accent-400/40 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:border-neutral-500"
                value={status}
                onChange={(event) => setStatus(event.target.value as ProjectStatus)}
              >
                {STATUSES.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500" />
            </div>
          </label>

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
                  await onSave(project, {
                    status,
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
                  await onDelete(project);
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
              onClick={async () => {
                if (!onMarkReviewed) return;
                await onMarkReviewed(project);
              }}
            >
              Mark Reviewed
            </Button>

            <Button
              type="button"
              variant="outline"
              onClick={async () => {
                if (!onRequestUpdate) return;
                await onRequestUpdate(project);
              }}
            >
              Request Update
            </Button>

            {project.hasRoadmap ? (
              <Button
                type="button"
                variant="outline"
                onClick={async () => {
                  if (!onViewRoadmap) return;
                  await onViewRoadmap(project);
                }}
              >
                View Roadmap
              </Button>
            ) : null}

            {project.frontmatter.localPath ? (
              <Button
                type="button"
                variant="secondary"
                onClick={async () => {
                  if (!onCommitRepo) return;
                  await onCommitRepo(project);
                }}
              >
                Commit Planning Docs
              </Button>
            ) : null}

            {project.frontmatter.localPath ? (
              <Button
                type="button"
                variant="secondary"
                onClick={async () => {
                  if (!onPushRepo) return;
                  await onPushRepo(project);
                }}
              >
                Push Repo
              </Button>
            ) : null}
          </div>
        </div>

        <div className="mt-4 grid gap-1 rounded-xl border border-neutral-200 bg-neutral-50 p-4 text-xs dark:border-neutral-700 dark:bg-neutral-800">
          <p><strong>Dashboard file:</strong> {project.filePath}</p>
          {project.repoFilePath ? <p><strong>Repo file:</strong> {project.repoFilePath}</p> : null}
          {project.frontmatter.parent ? (
            <p><strong>Parent:</strong> {project.frontmatter.parent}</p>
          ) : null}
          <div className="mt-1 flex flex-wrap gap-2">
            <Badge variant={project.hasRepo ? 'success' : 'outline'}>
              {project.hasRepo ? 'Repo-linked project' : 'Dashboard-only project'}
            </Badge>
            {project.children.length > 0 ? (
              <Badge variant="accent">{project.children.length} sub-project(s)</Badge>
            ) : null}
            {project.hasRoadmap ? <Badge variant="accent">Roadmap available</Badge> : null}
            {project.gitStatus ? (
              <Badge variant="outline">
                Git: {project.gitStatus.state}
                {project.gitStatus.branch ? ` (${project.gitStatus.branch})` : ''}
              </Badge>
            ) : null}
            {project.commitActivity ? (
              <Badge variant="outline">
                GitHub: {project.commitActivity.commitsThisWeek} commit(s)/week
              </Badge>
            ) : null}
          </div>
        </div>

        {project.children.length > 0 ? (
          <div className="mt-4 rounded-xl border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-700 dark:bg-neutral-800">
            <h3 className="mb-2 text-sm font-semibold">Sub-projects</h3>
            <div className="flex flex-wrap gap-2">
              {project.children.map((child) => (
                <Button
                  key={child.id}
                  variant="secondary"
                  size="sm"
                  onClick={() => onOpenLinkedProject?.(child.id)}
                >
                  {child.icon ? `${child.icon} ` : ''}
                  {child.title}
                </Button>
              ))}
            </div>
          </div>
        ) : null}

        {project.frontmatter.parent ? (
          <div className="mt-4 rounded-xl border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-700 dark:bg-neutral-800">
            <h3 className="mb-2 text-sm font-semibold">Linked parent</h3>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onOpenLinkedProject?.(project.frontmatter.parent ?? '')}
            >
              {project.frontmatter.parent}
            </Button>
          </div>
        ) : null}

        <div className="prose mt-4 max-w-none rounded-xl border border-neutral-200 bg-neutral-50 p-4 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:prose-invert">
          <ReactMarkdown>{project.content || '_No markdown content_'}</ReactMarkdown>
        </div>
      </div>
    </div>
  );
}
