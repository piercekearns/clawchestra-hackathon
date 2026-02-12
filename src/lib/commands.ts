// Slash commands available in chat
// Loads dynamically from Tauri backend which scans:
// 1. ~/.config/opencode/opencode.json (workflow commands)
// 2. ~/.claude/plugins/cache/.../compound-engineering/*/commands/ (plugin commands)
// 3. ~/.config/opencode/skills/ (skills)
// 4. OpenClaw TUI built-in commands

export interface SlashCommand {
  name: string;
  desc: string;
  category: 'workflow' | 'plugin' | 'skill' | 'session' | 'openclaw';
  source?: string; // e.g., 'openclaw', 'compound', 'skill:context7'
}

// All loaded commands (populated at runtime)
let allLoadedCommands: SlashCommand[] = [];
let commandsLoaded = false;
let loadPromise: Promise<SlashCommand[]> | null = null;

// Load commands from Tauri backend
export async function loadCompoundCommands(): Promise<SlashCommand[]> {
  if (commandsLoaded) return allLoadedCommands;
  
  // Prevent multiple concurrent loads
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    try {
      if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
        const { listSlashCommands } = await import('./tauri');
        const commands = await listSlashCommands();
        
        const loadedCommands: SlashCommand[] = commands.map((cmd) => ({
          name: cmd.name,
          desc: cmd.desc,
          category: cmd.category as SlashCommand['category'],
          source: cmd.source ?? 'compound',
        }));
        
        // Merge with OpenClaw commands
        const openclawCommands = getOpenClawCommands();
        
        // Build set of loaded command names for conflict detection
        const loadedNames = new Set(loadedCommands.map(c => c.name));
        
        // Add OpenClaw commands, handling conflicts by prefixing
        for (const cmd of openclawCommands) {
          if (loadedNames.has(cmd.name)) {
            // Conflict: add both with source prefix
            // Keep the original and add OpenClaw version with prefix
            loadedCommands.push({
              ...cmd,
              name: `openclaw:${cmd.name}`,
            });
            console.log(`[Commands] Conflict: "${cmd.name}" exists, added as "openclaw:${cmd.name}"`);
          } else {
            loadedCommands.push(cmd);
            loadedNames.add(cmd.name);
          }
        }
        
        allLoadedCommands = loadedCommands;
        console.log(`[Commands] Loaded ${allLoadedCommands.length} commands (${loadedCommands.length - openclawCommands.length} from Tauri + ${openclawCommands.length} OpenClaw)`);
      } else {
        // Not in Tauri - use defaults
        allLoadedCommands = getDefaultCommands();
        console.log('[Commands] Using default commands (not in Tauri)');
      }
    } catch (error) {
      console.error('[Commands] Failed to load commands:', error);
      allLoadedCommands = getDefaultCommands();
    }
    
    commandsLoaded = true;
    loadPromise = null;
    return allLoadedCommands;
  })();

  return loadPromise;
}

// Force reload commands (e.g., after plugin update)
export async function reloadCommands(): Promise<SlashCommand[]> {
  commandsLoaded = false;
  loadPromise = null;
  allLoadedCommands = [];
  return loadCompoundCommands();
}

// OpenClaw TUI built-in commands
function getOpenClawCommands(): SlashCommand[] {
  return [
    // Core
    { name: 'help', desc: 'Show available commands', category: 'openclaw', source: 'openclaw' },
    { name: 'status', desc: 'Show session and connection status', category: 'openclaw', source: 'openclaw' },
    { name: 'agent', desc: 'Switch agent or show current', category: 'openclaw', source: 'openclaw' },
    { name: 'agents', desc: 'List available agents', category: 'openclaw', source: 'openclaw' },
    { name: 'session', desc: 'Switch session or show current', category: 'openclaw', source: 'openclaw' },
    { name: 'sessions', desc: 'List sessions for current agent', category: 'openclaw', source: 'openclaw' },
    { name: 'model', desc: 'Set model override for session', category: 'openclaw', source: 'openclaw' },
    { name: 'models', desc: 'List available models', category: 'openclaw', source: 'openclaw' },
    // Session controls
    { name: 'think', desc: 'Toggle thinking/reasoning visibility', category: 'openclaw', source: 'openclaw' },
    { name: 'verbose', desc: 'Toggle verbose tool output', category: 'openclaw', source: 'openclaw' },
    { name: 'reasoning', desc: 'Set reasoning level (off/low/medium/high)', category: 'openclaw', source: 'openclaw' },
    { name: 'usage', desc: 'Show token usage for session', category: 'openclaw', source: 'openclaw' },
    { name: 'elevated', desc: 'Toggle elevated permissions', category: 'openclaw', source: 'openclaw' },
    { name: 'elev', desc: 'Toggle elevated permissions (alias)', category: 'openclaw', source: 'openclaw' },
    { name: 'deliver', desc: 'Toggle message delivery to channels', category: 'openclaw', source: 'openclaw' },
    // Session lifecycle
    { name: 'new', desc: 'Start a new session', category: 'openclaw', source: 'openclaw' },
    { name: 'reset', desc: 'Reset the current session', category: 'openclaw', source: 'openclaw' },
    { name: 'abort', desc: 'Abort the active run', category: 'openclaw', source: 'openclaw' },
    { name: 'settings', desc: 'Open settings panel', category: 'openclaw', source: 'openclaw' },
    { name: 'context', desc: 'Show session context', category: 'openclaw', source: 'openclaw' },
  ];
}

// Default commands if Tauri loading fails
function getDefaultCommands(): SlashCommand[] {
  return [
    // Workflow commands
    { name: 'plan', desc: 'Create implementation plans', category: 'workflow', source: 'compound' },
    { name: 'review', desc: 'Multi-agent code review', category: 'workflow', source: 'compound' },
    { name: 'work', desc: 'Execute plans with todo tracking', category: 'workflow', source: 'compound' },
    { name: 'deepen-plan', desc: 'Enhance plans with research', category: 'workflow', source: 'compound' },
    { name: 'brainstorm', desc: 'Explore requirements before planning', category: 'workflow', source: 'compound' },
    { name: 'compound', desc: 'Document solved problems', category: 'workflow', source: 'compound' },
    // Plugin commands
    { name: 'plan_review', desc: 'Multi-agent plan review in parallel', category: 'plugin', source: 'compound' },
    { name: 'triage', desc: 'Interactive todo triage', category: 'plugin', source: 'compound' },
    { name: 'resolve_todo_parallel', desc: 'Resolve todos in parallel', category: 'plugin', source: 'compound' },
    { name: 'test-browser', desc: 'Run browser tests', category: 'plugin', source: 'compound' },
    { name: 'lfg', desc: 'Quick start command', category: 'plugin', source: 'compound' },
    // OpenClaw commands
    ...getOpenClawCommands(),
  ];
}

// Get all commands
export function getAllCommands(): SlashCommand[] {
  return allLoadedCommands;
}

// Get total command count (for UI display)
export function getCommandCount(): number {
  return allLoadedCommands.length;
}

// Fuzzy match for filtering
function fuzzyMatch(query: string, target: string): { matches: boolean; score: number } {
  if (!query) return { matches: true, score: 1 };
  
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  
  // Exact prefix match gets highest score
  if (t.startsWith(q)) return { matches: true, score: 2 };
  
  // Word boundary match (e.g., "pr" matches "plan_review")
  const words = t.split(/[-_]/);
  const initials = words.map(w => w[0]).join('');
  if (initials.startsWith(q)) return { matches: true, score: 1.5 };
  
  // Contains match
  if (t.includes(q)) return { matches: true, score: 1.2 };
  
  // Fuzzy: all chars must appear in order
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  
  if (qi === q.length) {
    return { matches: true, score: q.length / t.length };
  }
  
  return { matches: false, score: 0 };
}

export function filterCommands(input: string): SlashCommand[] {
  if (!input.startsWith('/')) return [];
  
  const query = input.slice(1).toLowerCase();
  const allCommands = getAllCommands();
  
  return allCommands
    .map((cmd) => ({ cmd, ...fuzzyMatch(query, cmd.name) }))
    .filter((item) => item.matches)
    .sort((a, b) => b.score - a.score)
    .map((item) => item.cmd);
}

// Legacy export for backwards compatibility
export const COMMANDS = getDefaultCommands();
