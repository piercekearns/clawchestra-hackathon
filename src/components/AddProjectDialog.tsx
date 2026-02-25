import { useEffect, useMemo, useState } from 'react';
import { FolderOpen, RefreshCcw } from 'lucide-react';
import { ModalDragZone } from './ui/ModalDragZone';
import type { DashboardSettings } from '../lib/settings';
import type { ProjectViewModel } from '../lib/schema';
import { PROJECT_STATUSES, type ProjectStatus } from '../lib/constants';
import {
  addExistingProjectFlow,
  canonicalSlugify,
  checkExistingProjectCompatibility,
  chooseFolder,
  createNewProjectFlow,
  isReservedProjectId,
  type CompatibilityReport,
} from '../lib/project-flows';
import { Button } from './ui/button';
import { BrandedSelect } from './ui/branded-select';
import { Input } from './ui/input';

interface AddProjectDialogProps {
  open: boolean;
  settings: DashboardSettings | null;
  existingProjects: ProjectViewModel[];
  onClose: () => void;
  onComplete: (message: string) => Promise<void> | void;
  boardScoped?: boolean;
}

type WizardMode = 'create-new' | 'add-existing';

const STATUS_OPTIONS: readonly ProjectStatus[] = PROJECT_STATUSES;
const normalizePath = (value: string): string => value.replace(/\/+$/g, '');

export function AddProjectDialog({
  open,
  settings,
  existingProjects,
  onClose,
  onComplete,
  boardScoped,
}: AddProjectDialogProps) {
  const [mode, setMode] = useState<WizardMode>('create-new');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const scanPaths = settings?.scanPaths ?? [];
  const defaultRoot = scanPaths[0] ?? '';

  const [title, setTitle] = useState('');
  const [folderName, setFolderName] = useState('');
  const [folderEdited, setFolderEdited] = useState(false);
  const [scanPath, setScanPath] = useState(defaultRoot);
  const [status, setStatus] = useState<ProjectStatus>('up-next');
  const [priority, setPriority] = useState('');
  const [initializeGit, setInitializeGit] = useState(true);
  const [createAgents, setCreateAgents] = useState(true);

  const [existingFolderPath, setExistingFolderPath] = useState('');
  const [compatibility, setCompatibility] = useState<CompatibilityReport | null>(null);
  const [compatibilityLoading, setCompatibilityLoading] = useState(false);
  const [existingTitle, setExistingTitle] = useState('');
  const [existingId, setExistingId] = useState('');
  const [existingStatus, setExistingStatus] = useState<ProjectStatus>('pending');
  const [addMissingProjectMd, setAddMissingProjectMd] = useState(true);
  const [addMissingFrontmatter, setAddMissingFrontmatter] = useState(true);
  const [addMissingAgents, setAddMissingAgents] = useState(true);
  const [initGitIfMissing, setInitGitIfMissing] = useState(false);
  const [allowDirtyOverride, setAllowDirtyOverride] = useState(false);

  const canonicalCreateId = useMemo(() => canonicalSlugify(folderName || title), [folderName, title]);
  const hasCreateIdConflict = useMemo(
    () => existingProjects.some((project) => project.id === canonicalCreateId),
    [existingProjects, canonicalCreateId],
  );
  const canonicalExistingId = useMemo(
    () => canonicalSlugify(existingId || compatibility?.inferredId || ''),
    [compatibility?.inferredId, existingId],
  );
  const hasExistingIdConflict = useMemo(
    () => {
      const targetPath = normalizePath((compatibility?.folderPath || existingFolderPath).trim());
      return existingProjects.some((project) =>
        project.id === canonicalExistingId
        && normalizePath(project.dirPath) !== targetPath);
    },
    [existingProjects, canonicalExistingId, compatibility?.folderPath, existingFolderPath],
  );
  const canCreate =
    title.trim().length > 0
    && scanPath.trim().length > 0
    && !isReservedProjectId(canonicalCreateId)
    && !hasCreateIdConflict;

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

  useEffect(() => {
    if (!open) return;
    setError(null);
    setSaving(false);
    setCompatibility(null);
    setScanPath(defaultRoot);
  }, [defaultRoot, open]);

  useEffect(() => {
    if (folderEdited) return;
    setFolderName(canonicalSlugify(title));
  }, [folderEdited, title]);

  if (!open) return null;

  const runCompatibility = async () => {
    setError(null);
    setCompatibility(null);
    setCompatibilityLoading(true);
    try {
      const report = await checkExistingProjectCompatibility({
        folderPath: existingFolderPath,
        scanPaths: scanPaths.length > 0 ? scanPaths : [scanPath],
        existingProjects,
      });
      setCompatibility(report);
      setExistingTitle(report.inferredTitle);
      setExistingId(report.inferredId);
      setExistingStatus(report.detectedStatus ?? report.inferredStatus);
      setAddMissingProjectMd(!report.hasProjectMd);
      setAddMissingFrontmatter(report.projectMdStatus === 'missing-frontmatter');
      setAddMissingAgents(!report.hasAgentsMd);
      setInitGitIfMissing(!report.isGitRepo);
      setAllowDirtyOverride(false);
    } catch (value) {
      setError(value instanceof Error ? value.message : 'Compatibility check failed');
    } finally {
      setCompatibilityLoading(false);
    }
  };

  const overlayClass = `${boardScoped ? 'absolute' : 'fixed'} inset-0 z-50 flex items-center justify-center bg-neutral-950/40 p-4 backdrop-blur-sm`;

  return (
    <div className={overlayClass}>
      <ModalDragZone />
      <div className="w-full max-w-2xl rounded-2xl border border-neutral-200 bg-neutral-0 p-5 shadow-xl dark:border-neutral-700 dark:bg-neutral-900">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Project Wizard</h2>
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>

        <div className="mb-4 flex gap-2">
          <Button
            type="button"
            variant={mode === 'create-new' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setMode('create-new')}
          >
            Create New
          </Button>
          <Button
            type="button"
            variant={mode === 'add-existing' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setMode('add-existing')}
          >
            Add Existing
          </Button>
        </div>

        {mode === 'create-new' ? (
          <div className="grid gap-3">
            <label className="grid gap-1 text-sm">
              <span>Project title</span>
              <Input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Shopping App"
              />
            </label>

            <label className="grid gap-1 text-sm">
              <span>Folder name</span>
              <Input
                value={folderName}
                onChange={(event) => {
                  setFolderEdited(true);
                  setFolderName(event.target.value);
                }}
                placeholder="shopping-app"
              />
              <span className="text-xs text-neutral-500">Project id: <code>{canonicalCreateId}</code></span>
            </label>

            <label className="grid gap-1 text-sm">
              <span>Scan path</span>
              <div className="flex gap-2">
                <Input
                  value={scanPath}
                  onChange={(event) => setScanPath(event.target.value)}
                  placeholder="Select scan path..."
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-10 w-10 shrink-0"
                  onClick={async () => {
                    const picked = await chooseFolder(scanPath || null);
                    if (picked) setScanPath(picked);
                  }}
                  title="Choose folder"
                >
                  <FolderOpen className="h-4 w-4" />
                </Button>
              </div>
              {scanPaths.length > 0 && (
                <span className="text-xs text-neutral-500">
                  Configured: {scanPaths.join(', ')}
                </span>
              )}
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="grid gap-1 text-sm">
                <span>Status</span>
                <BrandedSelect
                  value={status}
                  onChange={(value) => setStatus(value as ProjectStatus)}
                  options={STATUS_OPTIONS.map((option) => ({ value: option, label: option }))}
                />
              </label>

              <label className="grid gap-1 text-sm">
                <span>Priority (optional)</span>
                <Input value={priority} onChange={(event) => setPriority(event.target.value)} />
              </label>
            </div>

            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={initializeGit}
                onChange={(event) => setInitializeGit(event.target.checked)}
                className="h-4 w-4 cursor-pointer rounded accent-[#DFFF00]"
              />
              Initialize git repository
            </label>
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={createAgents}
                onChange={(event) => setCreateAgents(event.target.checked)}
                className="h-4 w-4 cursor-pointer rounded accent-[#DFFF00]"
              />
              Create AGENTS.md
            </label>
            <p className="text-xs text-neutral-500">
              CLAUDE.md guidance injection is attempted automatically for git repos and does not block project creation.
            </p>

            {isReservedProjectId(canonicalCreateId) && (
              <p className="text-xs text-status-danger">This id is reserved. Use another folder name.</p>
            )}
            {hasCreateIdConflict && (
              <p className="text-xs text-status-danger">A project with this id already exists.</p>
            )}

            <div className="mt-2 flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={onClose}>
                Cancel
              </Button>
              <Button
                type="button"
                disabled={saving || !canCreate}
                onClick={async () => {
                  setError(null);
                  setSaving(true);
                  try {
                    const result = await createNewProjectFlow(
                      {
                        title,
                        folderName,
                        scanPath,
                        scanPaths,
                        status,
                        priority: priority.trim() ? Number(priority) : undefined,
                        initializeGit,
                        createAgents,
                      },
                      existingProjects,
                    );
                    const message = result.notes.length > 0
                      ? `Created ${result.id} — ${result.notes.join(' ')}`
                      : `Created ${result.id}`;
                    await onComplete(message);
                    onClose();
                  } catch (value) {
                    setError(value instanceof Error ? value.message : 'Create failed');
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                {saving ? 'Creating...' : 'Create Project'}
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid gap-3">
            <label className="grid gap-1 text-sm">
              <span>Existing folder path</span>
              <div className="flex gap-2">
                <Input
                  value={existingFolderPath}
                  onChange={(event) => setExistingFolderPath(event.target.value)}
                  placeholder="Select existing project folder..."
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-10 w-10 shrink-0"
                  onClick={async () => {
                    const picked = await chooseFolder(existingFolderPath || scanPath || null);
                    if (picked) setExistingFolderPath(picked);
                  }}
                  title="Choose folder"
                >
                  <FolderOpen className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-10 w-10 shrink-0"
                  disabled={compatibilityLoading || !existingFolderPath.trim()}
                  onClick={() => {
                    void runCompatibility();
                  }}
                  title="Run compatibility check"
                >
                  <RefreshCcw className={`h-4 w-4 ${compatibilityLoading ? 'animate-spin' : ''}`} />
                </Button>
              </div>
            </label>

            {compatibility && (
              <>
                <div className="rounded-lg border border-neutral-200 p-3 text-xs dark:border-neutral-700">
                  <p className="font-semibold">Compatibility Report</p>
                  <p>Git repo: {compatibility.isGitRepo ? 'yes' : 'no'}</p>
                  <p>CLAWCHESTRA.md: {compatibility.hasClawchestraMd ? 'found' : 'missing'}</p>
                  <p>Legacy PROJECT.md: {compatibility.hasLegacyProjectMd ? 'found' : 'missing'}</p>
                  <p>Legacy ROADMAP.md: {compatibility.hasRoadmapMd ? 'found (migration required)' : 'missing'}</p>
                  <p>state.json: {compatibility.hasStateJson ? 'found' : 'missing'}</p>
                  <p>AGENTS.md: {compatibility.hasAgentsMd ? 'found' : 'missing'}</p>
                  <p>Scan policy: {compatibility.insideScanPaths ? 'inside scan paths' : 'outside scan paths'}</p>
                  {compatibility.actions.length > 0 && (
                    <ul className="mt-2 list-disc pl-4">
                      {compatibility.actions.map((action) => (
                        <li key={`${action.file}-${action.description}`}>
                          {action.severity.toUpperCase()}: {action.description}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <label className="grid gap-1 text-sm">
                  <span>Title</span>
                  <Input value={existingTitle} onChange={(event) => setExistingTitle(event.target.value)} />
                </label>
                <label className="grid gap-1 text-sm">
                  <span>Project id</span>
                  <Input value={existingId} onChange={(event) => setExistingId(event.target.value)} />
                </label>
                {isReservedProjectId(canonicalExistingId) && (
                  <p className="text-xs text-status-danger">This id is reserved.</p>
                )}
                {hasExistingIdConflict && (
                  <p className="text-xs text-status-danger">A project with this id already exists.</p>
                )}
                <label className="grid gap-1 text-sm">
                  <span>Fallback status</span>
                  <BrandedSelect
                    value={existingStatus}
                    onChange={(value) => setExistingStatus(value as ProjectStatus)}
                    options={STATUS_OPTIONS.map((option) => ({ value: option, label: option }))}
                  />
                </label>

                <label className="inline-flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={addMissingProjectMd}
                    onChange={(event) => setAddMissingProjectMd(event.target.checked)}
                    className="h-4 w-4 cursor-pointer rounded accent-[#DFFF00]"
                  />
                  Create CLAWCHESTRA.md if missing
                </label>
                <label className="inline-flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={addMissingFrontmatter}
                    onChange={(event) => setAddMissingFrontmatter(event.target.checked)}
                    className="h-4 w-4 cursor-pointer rounded accent-[#DFFF00]"
                  />
                  Add PROJECT.md frontmatter when missing (legacy only)
                </label>
                <label className="inline-flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={addMissingAgents}
                    onChange={(event) => setAddMissingAgents(event.target.checked)}
                    className="h-4 w-4 cursor-pointer rounded accent-[#DFFF00]"
                  />
                  Create AGENTS.md when missing
                </label>
                <label className="inline-flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={initGitIfMissing}
                    onChange={(event) => setInitGitIfMissing(event.target.checked)}
                    className="h-4 w-4 cursor-pointer rounded accent-[#DFFF00]"
                  />
                  Initialize git if missing
                </label>
                <p className="text-xs text-neutral-500">
                  Guidance injection into CLAUDE.md is automatic for git repos and remains non-fatal.
                </p>

                {compatibility.isWorkingTreeDirty && (
                  <label className="inline-flex items-center gap-2 text-sm text-status-danger">
                    <input
                      type="checkbox"
                      checked={allowDirtyOverride}
                      onChange={(event) => setAllowDirtyOverride(event.target.checked)}
                      className="h-4 w-4 cursor-pointer rounded accent-[#DFFF00]"
                    />
                    Override dirty repo guard
                  </label>
                )}

                <div className="mt-2 flex justify-end gap-2">
                  <Button type="button" variant="secondary" onClick={onClose}>
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    disabled={
                      saving
                      || !compatibility
                      || isReservedProjectId(canonicalExistingId)
                      || hasExistingIdConflict
                    }
                    onClick={async () => {
                      if (!compatibility) return;
                      setError(null);
                      setSaving(true);
                      try {
                        const result = await addExistingProjectFlow(
                          {
                            report: compatibility,
                            id: existingId,
                            title: existingTitle,
                            fallbackStatus: existingStatus,
                            addMissingProjectMd,
                            addMissingFrontmatter,
                            addMissingAgents,
                            initGitIfMissing,
                            allowDirtyOverride,
                          },
                          existingProjects,
                        );
                        const message = result.notes.length > 0
                          ? `Added ${result.id} — ${result.notes.join(' ')}`
                          : `Added ${result.id}`;
                        await onComplete(message);
                        onClose();
                      } catch (value) {
                        setError(value instanceof Error ? value.message : 'Add existing failed');
                      } finally {
                        setSaving(false);
                      }
                    }}
                  >
                    {saving ? 'Adding...' : 'Add to Dashboard'}
                  </Button>
                </div>
              </>
            )}
          </div>
        )}

        {error && <p className="mt-3 text-sm text-status-danger">{error}</p>}
      </div>
    </div>
  );
}
