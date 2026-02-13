import matter from 'gray-matter';
import type { ChangelogDocument, ChangelogEntry } from './schema';
import { readRoadmap, writeRoadmap } from './roadmap';
import { pathExists, readFile, writeFile } from './tauri';

const MUTATION_LOCK_ERROR_PREFIX = 'mutationLocked:';
const MAX_MUTATION_RETRIES = 4;
const RETRY_BASE_DELAY_MS = 75;

function isMutationLockedError(error: unknown): boolean {
  return error instanceof Error && error.message.includes(MUTATION_LOCK_ERROR_PREFIX);
}

async function withMutationRetry<T>(operation: () => Promise<T>): Promise<T> {
  let attempt = 0;
  while (attempt < MAX_MUTATION_RETRIES) {
    try {
      return await operation();
    } catch (error) {
      attempt += 1;
      if (!isMutationLockedError(error) || attempt >= MAX_MUTATION_RETRIES) {
        throw error;
      }
      const backoff = RETRY_BASE_DELAY_MS * attempt;
      await new Promise((resolve) => setTimeout(resolve, backoff));
    }
  }
  throw new Error('Mutation retry loop exited unexpectedly');
}

export function sanitizeChangelogEntry(raw: unknown): ChangelogEntry | null {
  if (typeof raw !== 'object' || raw === null) return null;

  const record = raw as Record<string, unknown>;
  if (typeof record.id !== 'string' || !record.id.trim()) return null;
  if (typeof record.title !== 'string' || !record.title.trim()) return null;
  if (typeof record.completedAt !== 'string' || !record.completedAt.trim()) return null;

  // Validate completedAt as a plausible date
  const parsed = Date.parse(record.completedAt);
  if (Number.isNaN(parsed)) return null;

  return {
    id: record.id,
    title: record.title,
    completedAt: record.completedAt,
    summary: typeof record.summary === 'string' ? record.summary : undefined,
  };
}

export async function parseChangelog(filePath: string): Promise<ChangelogDocument> {
  const raw = await readFile(filePath);
  const { data } = matter(raw);

  const entriesRaw = (data as Record<string, unknown>).entries;
  const entries = Array.isArray(entriesRaw)
    ? entriesRaw
        .map((entry) => sanitizeChangelogEntry(entry))
        .filter((entry): entry is ChangelogEntry => entry !== null)
    : [];

  return { filePath, entries };
}

export async function writeChangelog(doc: ChangelogDocument): Promise<void> {
  const payloadEntries = doc.entries.map((entry) => ({
    id: entry.id,
    title: entry.title,
    completedAt: entry.completedAt,
    ...(entry.summary !== undefined ? { summary: entry.summary } : {}),
  }));

  const content = matter.stringify('', { entries: payloadEntries });
  await writeFile(doc.filePath, content);
}

export async function appendChangelogEntry(
  filePath: string,
  entry: ChangelogEntry,
): Promise<void> {
  let doc: ChangelogDocument;
  try {
    doc = await parseChangelog(filePath);
  } catch {
    doc = { filePath, entries: [] };
  }

  // Idempotency: skip if entry with same ID already exists
  if (doc.entries.some((existing) => existing.id === entry.id)) return;

  // Prepend (reverse-chronological)
  doc.entries = [entry, ...doc.entries];
  await writeChangelog(doc);
}

const EMPTY_CHANGELOG_SCAFFOLD = `---
entries: []
---
`;

export async function migrateCompletedItem(
  roadmapPath: string,
  changelogPath: string,
  itemId: string,
): Promise<void> {
  // 1. Create CHANGELOG.md if it doesn't exist
  const changelogExists = await pathExists(changelogPath);
  if (!changelogExists) {
    await writeFile(changelogPath, EMPTY_CHANGELOG_SCAFFOLD);
  }

  // 2. Read ROADMAP.md, find item
  const roadmap = await readRoadmap(roadmapPath);
  const item = roadmap.items.find((i) => i.id === itemId);
  if (!item) return; // Item already removed from roadmap

  // 3. Read CHANGELOG and check idempotency
  const changelog = await parseChangelog(changelogPath);
  const alreadyMigrated = changelog.entries.some((e) => e.id === itemId);

  // 4. If not in CHANGELOG, append entry (with mutation retry)
  if (!alreadyMigrated) {
    const entry: ChangelogEntry = {
      id: item.id,
      title: item.title,
      completedAt: new Date().toISOString().split('T')[0],
      summary: item.nextAction || item.title,
    };
    await withMutationRetry(() => appendChangelogEntry(changelogPath, entry));
  }

  // 5. Remove item from ROADMAP.md (with mutation retry)
  const updatedItems = roadmap.items.filter((i) => i.id !== itemId);
  await withMutationRetry(() =>
    writeRoadmap({
      filePath: roadmap.filePath,
      items: updatedItems.map((i, index) => ({ ...i, priority: index + 1 })),
      notes: roadmap.notes,
    }),
  );
}
