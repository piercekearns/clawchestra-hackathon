import { afterEach, describe, expect, it, mock } from 'bun:test';

type TestState = {
  files: Map<string, string>;
  dirs: Set<string>;
  createDirCalls: number;
  createDirLockFailuresRemaining: number;
  gitInitFailuresRemaining: number;
  createProjectWithStateCalls: number;
  createProjectWithStateFailuresRemaining: number;
  createProjectWithStateErrorMessage: string | null;
  runMigrationCalls: number;
  renameProjectMdCalls: number;
  injectAgentGuidanceCalls: number;
  callOrder: string[];
  renameProjectMdResult: boolean;
  injectionResults: Array<{ name: string; success: boolean; skipReason?: string }>;
};

function createState(): TestState {
  return {
    files: new Map(),
    dirs: new Set(),
    createDirCalls: 0,
    createDirLockFailuresRemaining: 0,
    gitInitFailuresRemaining: 0,
    createProjectWithStateCalls: 0,
    createProjectWithStateFailuresRemaining: 0,
    createProjectWithStateErrorMessage: null,
    runMigrationCalls: 0,
    renameProjectMdCalls: 0,
    injectAgentGuidanceCalls: 0,
    callOrder: [],
    renameProjectMdResult: true,
    injectionResults: [],
  };
}

function isPathPresent(state: TestState, path: string): boolean {
  return state.files.has(path) || state.dirs.has(path);
}

function removePathRecursive(state: TestState, target: string): void {
  for (const key of [...state.files.keys()]) {
    if (key === target || key.startsWith(`${target}/`)) {
      state.files.delete(key);
    }
  }
  for (const key of [...state.dirs.values()]) {
    if (key === target || key.startsWith(`${target}/`)) {
      state.dirs.delete(key);
    }
  }
}

function installMocks(state: TestState): void {
  mock.module('./tauri', () => ({
    createDirectory: async (path: string) => {
      state.createDirCalls += 1;
      if (state.createDirLockFailuresRemaining > 0) {
        state.createDirLockFailuresRemaining -= 1;
        throw new Error('mutationLocked: create_directory contention');
      }
      state.dirs.add(path);
    },
    createProjectWithState: async () => {
      state.callOrder.push('register');
      state.createProjectWithStateCalls += 1;
      if (state.createProjectWithStateErrorMessage) {
        throw new Error(state.createProjectWithStateErrorMessage);
      }
      if (state.createProjectWithStateFailuresRemaining > 0) {
        state.createProjectWithStateFailuresRemaining -= 1;
        throw new Error('state registration failed');
      }
    },
    gitInitRepo: async () => {
      if (state.gitInitFailuresRemaining > 0) {
        state.gitInitFailuresRemaining -= 1;
        throw new Error('git init failed');
      }
    },
    injectAgentGuidance: async () => {
      state.injectAgentGuidanceCalls += 1;
      return state.injectionResults;
    },
    pathExists: async (path: string) => isPathPresent(state, path),
    pickFolder: async () => null,
    probeRepo: async () => ({
      isGitRepo: false,
      dirtyPaths: [],
      isWorkingTreeDirty: false,
      gitBranch: undefined,
      gitRemote: undefined,
    }),
    readFile: async (path: string) => {
      const value = state.files.get(path);
      if (value === undefined) {
        throw new Error(`missing file: ${path}`);
      }
      return value;
    },
    removePath: async (path: string) => {
      removePathRecursive(state, path);
    },
    writeFile: async (path: string, content: string) => {
      const parent = path.split('/').slice(0, -1).join('/');
      if (parent) state.dirs.add(parent);
      state.files.set(path, content);
    },
    renameProjectMd: async () => {
      state.renameProjectMdCalls += 1;
      if (state.renameProjectMdResult) {
        for (const [path, content] of [...state.files.entries()]) {
          if (path.endsWith('/PROJECT.md')) {
            const canonicalPath = path.replace(/\/PROJECT\.md$/, '/CLAWCHESTRA.md');
            if (!state.files.has(canonicalPath)) {
              state.files.set(canonicalPath, content);
              state.files.delete(path);
            }
          }
        }
      }
      return state.renameProjectMdResult;
    },
    runMigration: async (_projectId: string, projectPath: string) => {
      state.callOrder.push('migrate');
      state.runMigrationCalls += 1;
      return {
        projectPath,
        stepBefore: 'NotStarted',
        stepAfter: 'Complete',
        itemsImported: 0,
        warnings: [],
        error: null,
      };
    },
  }));
}

async function importFlowsFresh() {
  return import(`./project-flows.ts?case=${Math.random()}`);
}

afterEach(() => {
  mock.restore();
});

describe('project flow hardening', () => {
  it('retries mutation lock errors for create flow writes', async () => {
    const state = createState();
    installMocks(state);
    state.createDirLockFailuresRemaining = 2;

    const flows = await importFlowsFresh();
    const result = await flows.createNewProjectFlow(
      {
        title: 'Shopping App',
        folderName: 'shopping-app',
        scanPath: '/workspace',
        scanPaths: ['/workspace'],
        status: 'up-next',
        initializeGit: false,
        createAgents: false,
      },
      [],
    );

    expect(result.id).toBe('shopping-app');
    expect(state.createDirCalls).toBe(3);
    expect(state.files.has('/workspace/shopping-app/CLAWCHESTRA.md')).toBe(true);
    expect(state.createProjectWithStateCalls).toBe(1);
  });

  it('rolls back create flow when git init fails', async () => {
    const state = createState();
    installMocks(state);
    state.gitInitFailuresRemaining = 1;

    const flows = await importFlowsFresh();

    await expect(
      flows.createNewProjectFlow(
        {
          title: 'Shopping App',
          folderName: 'shopping-app',
          scanPath: '/workspace',
          scanPaths: ['/workspace'],
          status: 'up-next',
          initializeGit: true,
          createAgents: true,
        },
        [],
      ),
    ).rejects.toThrow('git init failed');

    expect(isPathPresent(state, '/workspace/shopping-app')).toBe(false);
  });

  it('rolls back create flow when state registration fails', async () => {
    const state = createState();
    installMocks(state);
    state.createProjectWithStateFailuresRemaining = 1;

    const flows = await importFlowsFresh();

    await expect(
      flows.createNewProjectFlow(
        {
          title: 'Shopping App',
          folderName: 'shopping-app',
          scanPath: '/workspace',
          scanPaths: ['/workspace'],
          status: 'up-next',
          initializeGit: false,
          createAgents: true,
        },
        [],
      ),
    ).rejects.toThrow('state registration failed');

    expect(isPathPresent(state, '/workspace/shopping-app')).toBe(false);
  });

  it('treats create retry as no-op when canonical files already exist', async () => {
    const state = createState();
    installMocks(state);
    state.dirs.add('/workspace/shopping-app');
    state.files.set('/workspace/shopping-app/CLAWCHESTRA.md', '# Shopping App');
    state.files.set('/workspace/shopping-app/.clawchestra/state.json', '{"project":{"id":"shopping-app"}}');

    const flows = await importFlowsFresh();
    const result = await flows.createNewProjectFlow(
      {
        title: 'Shopping App',
        folderName: 'shopping-app',
        scanPath: '/workspace',
        scanPaths: ['/workspace'],
        status: 'up-next',
        initializeGit: false,
        createAgents: false,
      },
      [],
    );

    expect(result.id).toBe('shopping-app');
    expect(state.createDirCalls).toBe(0);
    expect(state.createProjectWithStateCalls).toBe(1);
  });

  it('surfaces guidance injection skip notes for create flow', async () => {
    const state = createState();
    installMocks(state);
    state.injectionResults = [{ name: 'main', success: false, skipReason: 'already_injected' }];

    const flows = await importFlowsFresh();
    const result = await flows.createNewProjectFlow(
      {
        title: 'Shopping App',
        folderName: 'shopping-app',
        scanPath: '/workspace',
        scanPaths: ['/workspace'],
        status: 'up-next',
        initializeGit: true,
        createAgents: false,
      },
      [],
    );

    expect(result.notes.length).toBeGreaterThan(0);
    expect(result.notes[0]).toContain('Guidance injection skipped');
  });

  it('restores edited files when add-existing fails late', async () => {
    const state = createState();
    installMocks(state);
    state.gitInitFailuresRemaining = 1;
    state.dirs.add('/workspace/existing-app');
    state.files.set('/workspace/existing-app/PROJECT.md', 'plain body without frontmatter');

    const flows = await importFlowsFresh();

    await expect(
      flows.addExistingProjectFlow(
        {
          report: {
            folderPath: '/workspace/existing-app',
            folderName: 'existing-app',
            isGitRepo: false,
            hasClawchestraMd: false,
            hasLegacyProjectMd: true,
            hasProjectMd: true,
            projectMdStatus: 'missing-frontmatter',
            hasRoadmapMd: false,
            hasStateJson: false,
            hasAgentsMd: false,
            hasReadme: false,
            inferredTitle: 'Existing App',
            inferredId: 'existing-app',
            inferredStatus: 'pending',
            detectedStatus: undefined,
            inferredRepo: undefined,
            idConflict: false,
            conflictingEntryId: undefined,
            insideScanPaths: true,
            matchedScanPath: '/workspace',
            isWorkingTreeDirty: false,
            dirtyPaths: [],
            actions: [],
          },
          id: 'existing-app',
          title: 'Existing App',
          fallbackStatus: 'pending',
          addMissingProjectMd: false,
          addMissingFrontmatter: true,
          addMissingAgents: true,
          initGitIfMissing: true,
          allowDirtyOverride: false,
        },
        [],
      ),
    ).rejects.toThrow('git init failed');

    expect(state.files.get('/workspace/existing-app/PROJECT.md')).toBe('plain body without frontmatter');
    expect(state.files.has('/workspace/existing-app/ROADMAP.md')).toBe(false);
    expect(state.files.has('/workspace/existing-app/AGENTS.md')).toBe(false);
  });

  it('runs migration before registration on legacy roadmap add-existing flow', async () => {
    const state = createState();
    installMocks(state);
    state.dirs.add('/workspace/legacy-app');
    state.files.set('/workspace/legacy-app/PROJECT.md', '---\ntitle: Legacy App\n---\n');
    state.files.set('/workspace/legacy-app/ROADMAP.md', 'legacy roadmap');

    const flows = await importFlowsFresh();
    await flows.addExistingProjectFlow(
      {
        report: {
          folderPath: '/workspace/legacy-app',
          folderName: 'legacy-app',
          isGitRepo: true,
          hasClawchestraMd: false,
          hasLegacyProjectMd: true,
          hasProjectMd: true,
          projectMdStatus: 'valid',
          hasRoadmapMd: true,
          hasStateJson: false,
          hasAgentsMd: true,
          hasReadme: false,
          inferredTitle: 'Legacy App',
          inferredId: 'legacy-app',
          inferredStatus: 'pending',
          detectedStatus: 'pending',
          inferredRepo: undefined,
          idConflict: false,
          conflictingEntryId: undefined,
          insideScanPaths: true,
          matchedScanPath: '/workspace',
          isWorkingTreeDirty: false,
          dirtyPaths: [],
          actions: [],
        },
        id: 'legacy-app',
        title: 'Legacy App',
        fallbackStatus: 'pending',
        addMissingProjectMd: false,
        addMissingFrontmatter: false,
        addMissingAgents: false,
        initGitIfMissing: false,
        allowDirtyOverride: false,
      },
      [],
    );

    expect(state.runMigrationCalls).toBe(1);
    expect(state.createProjectWithStateCalls).toBe(1);
    expect(state.callOrder).toEqual(['migrate', 'register']);
    expect(state.renameProjectMdCalls).toBe(1);
    expect(state.injectAgentGuidanceCalls).toBe(1);
  });

  it('registers modern add-existing projects immediately without migration', async () => {
    const state = createState();
    installMocks(state);
    state.dirs.add('/workspace/modern-app');
    state.files.set('/workspace/modern-app/CLAWCHESTRA.md', '# Modern App');

    const flows = await importFlowsFresh();
    await flows.addExistingProjectFlow(
      {
        report: {
          folderPath: '/workspace/modern-app',
          folderName: 'modern-app',
          isGitRepo: false,
          hasClawchestraMd: true,
          hasLegacyProjectMd: false,
          hasProjectMd: true,
          projectMdStatus: 'valid',
          hasRoadmapMd: false,
          hasStateJson: false,
          hasAgentsMd: true,
          hasReadme: false,
          inferredTitle: 'Modern App',
          inferredId: 'modern-app',
          inferredStatus: 'pending',
          detectedStatus: 'pending',
          inferredRepo: undefined,
          idConflict: false,
          conflictingEntryId: undefined,
          insideScanPaths: true,
          matchedScanPath: '/workspace',
          isWorkingTreeDirty: false,
          dirtyPaths: [],
          actions: [],
        },
        id: 'modern-app',
        title: 'Modern App',
        fallbackStatus: 'pending',
        addMissingProjectMd: false,
        addMissingFrontmatter: false,
        addMissingAgents: false,
        initGitIfMissing: false,
        allowDirtyOverride: false,
      },
      [],
    );

    expect(state.runMigrationCalls).toBe(0);
    expect(state.createProjectWithStateCalls).toBe(1);
  });

  it('allows add-existing retry for same id + same folder', async () => {
    const state = createState();
    installMocks(state);
    state.dirs.add('/workspace/existing-app');
    state.files.set('/workspace/existing-app/CLAWCHESTRA.md', '# Existing App');

    const flows = await importFlowsFresh();
    await flows.addExistingProjectFlow(
      {
        report: {
          folderPath: '/workspace/existing-app',
          folderName: 'existing-app',
          isGitRepo: false,
          hasClawchestraMd: true,
          hasLegacyProjectMd: false,
          hasProjectMd: true,
          projectMdStatus: 'valid',
          hasRoadmapMd: false,
          hasStateJson: false,
          hasAgentsMd: true,
          hasReadme: false,
          inferredTitle: 'Existing App',
          inferredId: 'existing-app',
          inferredStatus: 'pending',
          detectedStatus: 'pending',
          inferredRepo: undefined,
          idConflict: false,
          conflictingEntryId: undefined,
          insideScanPaths: true,
          matchedScanPath: '/workspace',
          isWorkingTreeDirty: false,
          dirtyPaths: [],
          actions: [],
        },
        id: 'existing-app',
        title: 'Existing App',
        fallbackStatus: 'pending',
        addMissingProjectMd: false,
        addMissingFrontmatter: false,
        addMissingAgents: false,
        initGitIfMissing: false,
        allowDirtyOverride: false,
      },
      [{ id: 'existing-app', dirPath: '/workspace/existing-app' } as unknown as any],
    );

    expect(state.createProjectWithStateCalls).toBe(1);
  });

  it('rejects add-existing when same id points at different folder', async () => {
    const state = createState();
    installMocks(state);
    state.dirs.add('/workspace/existing-app');
    state.files.set('/workspace/existing-app/CLAWCHESTRA.md', '# Existing App');

    const flows = await importFlowsFresh();
    await expect(
      flows.addExistingProjectFlow(
        {
          report: {
            folderPath: '/workspace/existing-app',
            folderName: 'existing-app',
            isGitRepo: false,
            hasClawchestraMd: true,
            hasLegacyProjectMd: false,
            hasProjectMd: true,
            projectMdStatus: 'valid',
            hasRoadmapMd: false,
            hasStateJson: false,
            hasAgentsMd: true,
            hasReadme: false,
            inferredTitle: 'Existing App',
            inferredId: 'existing-app',
            inferredStatus: 'pending',
            detectedStatus: 'pending',
            inferredRepo: undefined,
            idConflict: false,
            conflictingEntryId: undefined,
            insideScanPaths: true,
            matchedScanPath: '/workspace',
            isWorkingTreeDirty: false,
            dirtyPaths: [],
            actions: [],
          },
          id: 'existing-app',
          title: 'Existing App',
          fallbackStatus: 'pending',
          addMissingProjectMd: false,
          addMissingFrontmatter: false,
          addMissingAgents: false,
          initGitIfMissing: false,
          allowDirtyOverride: false,
        },
        [{ id: 'existing-app', dirPath: '/workspace/different-app' } as unknown as any],
      ),
    ).rejects.toThrow('already exists');
  });

  it('returns explicit backend conflict for same path + different id', async () => {
    const state = createState();
    installMocks(state);
    state.createProjectWithStateErrorMessage = "Path '/workspace/existing-app' is already tracked under project id 'existing-app'";
    state.dirs.add('/workspace/existing-app');
    state.files.set('/workspace/existing-app/CLAWCHESTRA.md', '# Existing App');

    const flows = await importFlowsFresh();
    await expect(
      flows.addExistingProjectFlow(
        {
          report: {
            folderPath: '/workspace/existing-app',
            folderName: 'existing-app',
            isGitRepo: false,
            hasClawchestraMd: true,
            hasLegacyProjectMd: false,
            hasProjectMd: true,
            projectMdStatus: 'valid',
            hasRoadmapMd: false,
            hasStateJson: false,
            hasAgentsMd: true,
            hasReadme: false,
            inferredTitle: 'Existing App',
            inferredId: 'existing-app',
            inferredStatus: 'pending',
            detectedStatus: 'pending',
            inferredRepo: undefined,
            idConflict: false,
            conflictingEntryId: undefined,
            insideScanPaths: true,
            matchedScanPath: '/workspace',
            isWorkingTreeDirty: false,
            dirtyPaths: [],
            actions: [],
          },
          id: 'another-id',
          title: 'Existing App',
          fallbackStatus: 'pending',
          addMissingProjectMd: false,
          addMissingFrontmatter: false,
          addMissingAgents: false,
          initGitIfMissing: false,
          allowDirtyOverride: false,
        },
        [],
      ),
    ).rejects.toThrow("already tracked under project id");
  });

  it('backs up pre-existing state.json before add-existing registration', async () => {
    const state = createState();
    installMocks(state);
    state.dirs.add('/workspace/existing-app');
    state.dirs.add('/workspace/existing-app/.clawchestra');
    state.files.set('/workspace/existing-app/CLAWCHESTRA.md', '# Existing App');
    state.files.set('/workspace/existing-app/.clawchestra/state.json', '{"project":{"id":"existing-app"}}');

    const flows = await importFlowsFresh();
    await flows.addExistingProjectFlow(
      {
        report: {
          folderPath: '/workspace/existing-app',
          folderName: 'existing-app',
          isGitRepo: false,
          hasClawchestraMd: true,
          hasLegacyProjectMd: false,
          hasProjectMd: true,
          projectMdStatus: 'valid',
          hasRoadmapMd: false,
          hasStateJson: true,
          hasAgentsMd: true,
          hasReadme: false,
          inferredTitle: 'Existing App',
          inferredId: 'existing-app',
          inferredStatus: 'pending',
          detectedStatus: 'pending',
          inferredRepo: undefined,
          idConflict: false,
          conflictingEntryId: undefined,
          insideScanPaths: true,
          matchedScanPath: '/workspace',
          isWorkingTreeDirty: false,
          dirtyPaths: [],
          actions: [],
        },
        id: 'existing-app',
        title: 'Existing App',
        fallbackStatus: 'pending',
        addMissingProjectMd: false,
        addMissingFrontmatter: false,
        addMissingAgents: false,
        initGitIfMissing: false,
        allowDirtyOverride: false,
      },
      [],
    );

    const backupPath = [...state.files.keys()].find((filePath) =>
      filePath.includes('/.clawchestra/backup/state.pre-onboarding.'),
    );
    expect(backupPath).toBeDefined();
    expect(backupPath ? state.files.get(backupPath) : undefined).toBe('{"project":{"id":"existing-app"}}');
    expect(state.createProjectWithStateCalls).toBe(1);
    expect(state.runMigrationCalls).toBe(0);
  });

  it('surfaces non-fatal rename and injection notes for add-existing flow', async () => {
    const state = createState();
    installMocks(state);
    state.renameProjectMdResult = false;
    state.injectionResults = [{ name: 'feature/a', success: false, skipReason: 'worktree_checked_out' }];
    state.dirs.add('/workspace/legacy-app');
    state.files.set('/workspace/legacy-app/CLAWCHESTRA.md', '# Legacy App');
    state.files.set('/workspace/legacy-app/PROJECT.md', '---\ntitle: Legacy App\n---\n');

    const flows = await importFlowsFresh();
    const result = await flows.addExistingProjectFlow(
      {
        report: {
          folderPath: '/workspace/legacy-app',
          folderName: 'legacy-app',
          isGitRepo: true,
          hasClawchestraMd: false,
          hasLegacyProjectMd: true,
          hasProjectMd: true,
          projectMdStatus: 'valid',
          hasRoadmapMd: false,
          hasStateJson: false,
          hasAgentsMd: true,
          hasReadme: false,
          inferredTitle: 'Legacy App',
          inferredId: 'legacy-app',
          inferredStatus: 'pending',
          detectedStatus: 'pending',
          inferredRepo: undefined,
          idConflict: false,
          conflictingEntryId: undefined,
          insideScanPaths: true,
          matchedScanPath: '/workspace',
          isWorkingTreeDirty: false,
          dirtyPaths: [],
          actions: [],
        },
        id: 'legacy-app',
        title: 'Legacy App',
        fallbackStatus: 'pending',
        addMissingProjectMd: false,
        addMissingFrontmatter: false,
        addMissingAgents: false,
        initGitIfMissing: false,
        allowDirtyOverride: false,
      },
      [],
    );

    expect(result.notes.some((note: string) => note.includes('PROJECT.md rename'))).toBe(true);
    expect(result.notes.some((note: string) => note.includes('Guidance injection skipped'))).toBe(true);
  });

  it('fails add-existing when canonical filename is still missing after rename step', async () => {
    const state = createState();
    installMocks(state);
    state.renameProjectMdResult = false;
    state.dirs.add('/workspace/legacy-app');
    state.files.set('/workspace/legacy-app/PROJECT.md', '---\ntitle: Legacy App\n---\n');

    const flows = await importFlowsFresh();
    await expect(
      flows.addExistingProjectFlow(
        {
          report: {
            folderPath: '/workspace/legacy-app',
            folderName: 'legacy-app',
            isGitRepo: false,
            hasClawchestraMd: false,
            hasLegacyProjectMd: true,
            hasProjectMd: true,
            projectMdStatus: 'valid',
            hasRoadmapMd: false,
            hasStateJson: false,
            hasAgentsMd: true,
            hasReadme: false,
            inferredTitle: 'Legacy App',
            inferredId: 'legacy-app',
            inferredStatus: 'pending',
            detectedStatus: 'pending',
            inferredRepo: undefined,
            idConflict: false,
            conflictingEntryId: undefined,
            insideScanPaths: true,
            matchedScanPath: '/workspace',
            isWorkingTreeDirty: false,
            dirtyPaths: [],
            actions: [],
          },
          id: 'legacy-app',
          title: 'Legacy App',
          fallbackStatus: 'pending',
          addMissingProjectMd: false,
          addMissingFrontmatter: false,
          addMissingAgents: false,
          initGitIfMissing: false,
          allowDirtyOverride: false,
        },
        [],
      ),
    ).rejects.toThrow('CLAWCHESTRA.md is missing');
  });
});
