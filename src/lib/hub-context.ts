/**
 * hub-context.ts — Scoped context injection for hub chats.
 *
 * Reads project files and assembles a context preamble for scoped chat sessions.
 * Each file is capped at 4000 chars; total injection capped at 16000 chars.
 * CAPABILITIES.md is always injected first (app-awareness for all surfaces).
 * AGENTS.md is only injected for the Clawchestra project itself (developer context).
 */

import { readFile, getCapabilitiesMd } from './tauri';
import { useDashboardStore } from './store';
import type { HubChat } from './hub-types';
import type { ProjectViewModel } from './schema';

const PER_FILE_LIMIT = 4000;
const TOTAL_LIMIT = 16000;

/** Cache CAPABILITIES.md content so we only call the Tauri command once. */
let cachedCapabilitiesMd: string | null = null;
async function loadCapabilitiesMd(): Promise<string> {
  if (cachedCapabilitiesMd === null) {
    cachedCapabilitiesMd = await getCapabilitiesMd();
  }
  return cachedCapabilitiesMd;
}

/** Check if a project directory is the Clawchestra app itself. */
async function isClawchestraProject(dirPath: string): Promise<boolean> {
  try {
    const content = await readFile(`${dirPath}/src-tauri/tauri.conf.json`);
    return content.includes('"clawchestra"');
  } catch {
    return false;
  }
}

function truncate(content: string, limit: number): string {
  if (content.length <= limit) return content;
  return content.slice(0, limit) + '\n[...truncated]';
}

/** Walk the project tree to find a project by ID. */
function findProject(projects: ProjectViewModel[], id: string): ProjectViewModel | undefined {
  for (const p of projects) {
    if (p.id === id) return p;
    if (p.children) {
      const found = findProject(p.children as ProjectViewModel[], id);
      if (found) return found;
    }
  }
  return undefined;
}

async function tryReadFile(path: string): Promise<string | null> {
  try {
    return await readFile(path);
  } catch {
    return null;
  }
}

interface ContextFile {
  label: string;
  content: string;
}

/**
 * Build a scoped context string for a hub chat.
 * Returns null if no context files could be read.
 *
 * Priority order (highest first):
 * 1. CLAWCHESTRA.md
 * 2. state.json roadmap items
 * 3. Item detail file (roadmap/{item-id}.md)
 * 4. Spec doc
 * 5. Plan doc
 * 6. AGENTS.md
 */
export async function buildScopedContext(chat: HubChat): Promise<string | null> {
  // Ad-hoc chats (no isProjectRoot, no itemId) get no automatic context
  if (!chat.isProjectRoot && !chat.itemId) return null;

  const { projects, roadmapItems } = useDashboardStore.getState();
  const project = findProject(projects, chat.projectId);

  if (!project) return null;

  const dir = project.dirPath;
  const files: ContextFile[] = [];

  // 0. CAPABILITIES.md — always first (app-awareness for all users/projects)
  const capabilitiesMd = await loadCapabilitiesMd();
  files.push({ label: 'CAPABILITIES.md (Clawchestra App Guide)', content: truncate(capabilitiesMd, PER_FILE_LIMIT) });

  // 1. CLAWCHESTRA.md
  const clawchestraMd = await tryReadFile(`${dir}/CLAWCHESTRA.md`);
  if (clawchestraMd) {
    files.push({ label: 'CLAWCHESTRA.md', content: truncate(clawchestraMd, PER_FILE_LIMIT) });
  }

  // 2. state.json roadmap items (from store, already parsed)
  const items = roadmapItems[chat.projectId];
  if (items && items.length > 0) {
    const summary = items
      .map((i) => `- [${i.status}] ${i.title}${i.nextAction ? ` → ${i.nextAction}` : ''}`)
      .join('\n');
    files.push({ label: 'Roadmap Items', content: truncate(summary, PER_FILE_LIMIT) });
  }

  // For item-scoped chats, add item-specific files
  if (chat.itemId) {
    const item = items?.find((i) => i.id === chat.itemId);

    // 3. Item detail file
    const detailContent = await tryReadFile(`${dir}/roadmap/${chat.itemId}.md`);
    if (detailContent) {
      files.push({ label: `roadmap/${chat.itemId}.md`, content: truncate(detailContent, PER_FILE_LIMIT) });
    }

    // 4. Spec doc
    if (item?.specDoc) {
      const specContent = await tryReadFile(`${dir}/${item.specDoc}`);
      if (specContent) {
        files.push({ label: item.specDoc, content: truncate(specContent, PER_FILE_LIMIT) });
      }
    }

    // 5. Plan doc
    if (item?.planDoc) {
      const planContent = await tryReadFile(`${dir}/${item.planDoc}`);
      if (planContent) {
        files.push({ label: item.planDoc, content: truncate(planContent, PER_FILE_LIMIT) });
      }
    }
  }

  // 6. AGENTS.md — only for the Clawchestra project itself (developer context)
  if (await isClawchestraProject(dir)) {
    const agentsMd = await tryReadFile(`${dir}/AGENTS.md`);
    if (agentsMd) {
      files.push({ label: 'AGENTS.md (Developer Context)', content: truncate(agentsMd, PER_FILE_LIMIT) });
    }
  }

  if (files.length === 0) return null;

  // Apply total limit — drop lowest-priority files first
  let total = 0;
  const included: ContextFile[] = [];
  for (const file of files) {
    if (total + file.content.length > TOTAL_LIMIT) {
      const remaining = TOTAL_LIMIT - total;
      if (remaining > 200) {
        included.push({ label: file.label, content: truncate(file.content, remaining) });
      }
      break;
    }
    included.push(file);
    total += file.content.length;
  }

  // Format as context block
  const sections = included.map(
    (f) => `### ${f.label}\n\n${f.content}`,
  );

  return `## Project Context: ${project.frontmatter?.title ?? chat.projectId}\n\n${sections.join('\n\n---\n\n')}`;
}
