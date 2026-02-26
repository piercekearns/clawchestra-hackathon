#!/usr/bin/env bash
#
# inject-current-branch.sh — Injects the Clawchestra Integration section into
# CLAUDE.md on the current branch only. Designed for agents (Claude Code, Cursor)
# that cannot call Tauri commands directly.
#
# Usage: scripts/inject-current-branch.sh [project-dir]
#   project-dir: Path to the project (defaults to current directory)
#
# The script is idempotent — running it multiple times produces the same result.

set -euo pipefail

PROJECT_DIR="${1:-.}"
CLAUDE_MD="$PROJECT_DIR/CLAUDE.md"
SECTION_HEADER="## Clawchestra Integration"

SECTION_CONTENT="## Clawchestra Integration

Project orchestration state lives in \`.clawchestra/state.json\` (gitignored, always on disk).

**Read:** Open \`.clawchestra/state.json\` to see project status, roadmap items, priorities. Always read immediately before writing — do not cache contents across operations.
**Write:** Edit \`.clawchestra/state.json\` to update status, add items, change priorities. Include BOTH \`project\` and \`roadmapItems\` in every write. Clawchestra validates and syncs automatically.

**Schema rules:**
- Project statuses: in-progress | up-next | pending | dormant | archived
- Roadmap item statuses: pending | up-next | in-progress | complete | archived
- When setting status: complete, always set completedAt: YYYY-MM-DD
- Priorities are unique per column
- Do NOT delete items from state.json — removal requires explicit action via Clawchestra UI
- Items you omit from \`roadmapItems\` are NOT deleted — Clawchestra restores them on next projection

**After writing:** If your changes don't appear in state.json after writing, check \`.clawchestra/last-rejection.json\` for validation errors.

**Do NOT edit:** CLAWCHESTRA.md (human documentation only), any files in \`.clawchestra/\` other than state.json."

# Create CLAUDE.md if it doesn't exist
if [ ! -f "$CLAUDE_MD" ]; then
  printf "# CLAUDE.md\n\n%s\n" "$SECTION_CONTENT" > "$CLAUDE_MD"
  echo "Created $CLAUDE_MD with Clawchestra Integration section"
  exit 0
fi

# Check if section already exists
if grep -q "$SECTION_HEADER" "$CLAUDE_MD"; then
  echo "Clawchestra Integration section already present in $CLAUDE_MD"
  exit 0
fi

# Append section
printf "\n\n%s\n" "$SECTION_CONTENT" >> "$CLAUDE_MD"
echo "Appended Clawchestra Integration section to $CLAUDE_MD"
