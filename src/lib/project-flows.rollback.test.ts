import { afterEach, describe, expect, it, mock } from 'bun:test';

type TestState = {
  files: Map<string, string>;
  dirs: Set<string>;
  createDirCalls: number;
  createDirLockFailuresRemaining: number;
  gitInitFailuresRemaining: number;
};

function createState(): TestState {
  return {
    files: new Map(),
    dirs: new Set(),
    createDirCalls: 0,
    createDirLockFailuresRemaining: 0,
    gitInitFailuresRemaining: 0,
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
    gitInitRepo: async () => {
      if (state.gitInitFailuresRemaining > 0) {
        state.gitInitFailuresRemaining -= 1;
        throw new Error('git init failed');
      }
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
        createRoadmap: false,
        createAgents: false,
      },
      [],
    );

    expect(result.id).toBe('shopping-app');
    expect(state.createDirCalls).toBe(3);
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
          createRoadmap: true,
          createAgents: true,
        },
        [],
      ),
    ).rejects.toThrow('git init failed');

    expect(isPathPresent(state, '/workspace/shopping-app')).toBe(false);
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
            hasProjectMd: true,
            projectMdStatus: 'missing-frontmatter',
            hasRoadmapMd: false,
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
          addMissingRoadmap: true,
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
});
