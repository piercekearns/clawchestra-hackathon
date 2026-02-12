import { useEffect, useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import type { ProjectViewModel } from '../../lib/schema';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { cn } from '../../lib/utils';
import type { ProjectModalActions } from './types';

interface ProjectDetailsProps {
  project: ProjectViewModel;
  actions: Pick<
    ProjectModalActions,
    'onSave' | 'onDelete' | 'onMarkReviewed' | 'onCommitRepo' | 'onPushRepo' | 'onOpenLinkedProject'
  >;
}

export function ProjectDetails({ project, actions }: ProjectDetailsProps) {
  const [expanded, setExpanded] = useState(false);
  const [nextAction, setNextAction] = useState('');
  const [blockedBy, setBlockedBy] = useState('');
  const [tags, setTags] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    setNextAction(project.nextAction ?? '');
    setBlockedBy(project.blockedBy ?? '');
    setTags(project.tags?.join(', ') ?? '');
  }, [project]);

  const tagList = useMemo(
    () => tags.split(',').map((tag) => tag.trim()).filter(Boolean),
    [tags],
  );

  return (
    <div className="mt-4 rounded-xl border border-neutral-200 bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-4 py-3 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-700/50"
        onClick={() => setExpanded((prev) => !prev)}
      >
        <ChevronRight
          className={cn(
            'h-4 w-4 shrink-0 transition-transform',
            expanded && 'rotate-90',
          )}
        />
        Details
      </button>

      <div
        className="grid transition-[grid-template-rows] duration-200 ease-in-out"
        style={{ gridTemplateRows: expanded ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden">
          <div className="grid gap-3 px-4 pb-4">
            <label className="grid gap-1 text-sm">
              <span>Next Action</span>
              <Input
                value={nextAction}
                onChange={(e) => setNextAction(e.target.value)}
                placeholder="What should happen next?"
              />
            </label>

            <label className="grid gap-1 text-sm">
              <span>Tags (comma separated)</span>
              <Input
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="frontend, platform"
              />
            </label>

            <label className="grid gap-1 text-sm">
              <span>Blocked By</span>
              <Input
                value={blockedBy}
                onChange={(e) => setBlockedBy(e.target.value)}
                placeholder="Dependency or blocker"
              />
            </label>

            {project.frontmatter.lastReviewed && (
              <div className="text-sm text-neutral-600 dark:text-neutral-400">
                <strong>Last Reviewed:</strong> {String(project.frontmatter.lastReviewed)}
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <Badge variant={project.hasRepo ? 'success' : 'outline'}>
                {project.hasRepo ? 'Repo-linked' : 'Dashboard-only'}
              </Badge>
              {project.gitStatus && (
                <Badge variant="outline">
                  Git: {project.gitStatus.state}
                  {project.gitStatus.branch ? ` (${project.gitStatus.branch})` : ''}
                </Badge>
              )}
              {project.commitActivity && (
                <Badge variant="outline">
                  {project.commitActivity.commitsThisWeek} commit(s)/week
                </Badge>
              )}
            </div>

            {project.children.length > 0 && (
              <div>
                <p className="mb-1.5 text-sm font-medium">Sub-projects</p>
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
              <div>
                <p className="mb-1.5 text-sm font-medium">Parent</p>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => actions.onOpenLinkedProject(project.frontmatter.parent ?? '')}
                >
                  {project.frontmatter.parent}
                </Button>
              </div>
            )}

            <div className="grid gap-0.5 text-xs text-neutral-500">
              <p><strong>Dashboard file:</strong> {project.filePath}</p>
              {project.repoFilePath && <p><strong>Repo file:</strong> {project.repoFilePath}</p>}
            </div>

            <div className="flex flex-wrap items-center gap-2 border-t border-neutral-200 pt-3 dark:border-neutral-700">
              <Button
                type="button"
                onClick={async () => {
                  setSaving(true);
                  try {
                    await actions.onSave(project, {
                      nextAction: nextAction.trim() || null,
                      blockedBy: blockedBy.trim() || null,
                      tags: tagList.length ? tagList : null,
                    });
                  } finally {
                    setSaving(false);
                  }
                }}
                disabled={saving}
                size="sm"
              >
                {saving ? 'Saving...' : 'Save'}
              </Button>

              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={async () => {
                  setDeleting(true);
                  try {
                    await actions.onDelete(project);
                  } finally {
                    setDeleting(false);
                  }
                }}
                disabled={deleting}
              >
                {deleting ? 'Deleting...' : 'Delete'}
              </Button>

              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => void actions.onMarkReviewed(project)}
              >
                Mark Reviewed
              </Button>

              {project.frontmatter.localPath && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void actions.onCommitRepo(project)}
                >
                  Commit Planning Docs
                </Button>
              )}

              {project.frontmatter.localPath && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void actions.onPushRepo(project)}
                >
                  Push Repo
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
