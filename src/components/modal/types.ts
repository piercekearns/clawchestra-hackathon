import type { ProjectViewModel } from '../../lib/schema';
import type { ProjectUpdate } from '../../lib/projects';

export interface ProjectModalActions {
  onSave: (project: ProjectViewModel, updates: ProjectUpdate) => Promise<void>;
  onDelete: (project: ProjectViewModel) => Promise<void>;
  onMarkReviewed: (project: ProjectViewModel) => Promise<void>;
  onRequestUpdate: (project: ProjectViewModel) => Promise<void>;
  onCommitRepo: (project: ProjectViewModel) => Promise<void>;
  onPushRepo: (project: ProjectViewModel) => Promise<void>;
  onOpenLinkedProject: (projectId: string) => void;
}
