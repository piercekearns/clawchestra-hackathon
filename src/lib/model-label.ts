const CLAUDE_FAMILY_REGEX = /^claude-(opus|sonnet|haiku)-(\d+)-(\d+)$/i;
const GPT_CODEX_REGEX = /^gpt-(\d+(?:\.\d+)?)-codex$/i;

function titleCase(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatClaudeFamily(modelId: string): string | null {
  const match = modelId.match(CLAUDE_FAMILY_REGEX);
  if (!match) return null;
  const family = titleCase(match[1]);
  return `${family} ${match[2]}.${match[3]}`;
}

function formatGptCodex(modelId: string): string | null {
  const match = modelId.match(GPT_CODEX_REGEX);
  if (!match) return null;
  return `GPT-${match[1]}-Codex`;
}

function normalizeBaseModelId(modelId: string): string {
  const trimmed = modelId.trim();
  if (!trimmed) return trimmed;
  const parts = trimmed.split('/');
  return parts[parts.length - 1]?.trim() ?? trimmed;
}

function normalizeToken(token: string): string {
  if (!token) return token;
  if (/^\d+(?:\.\d+)*$/.test(token)) return token;
  if (token === 'gpt') return 'GPT';
  if (token === 'codex') return 'Codex';
  if (token === 'mini') return 'Mini';
  if (token === 'turbo') return 'Turbo';
  if (token === 'lite') return 'Lite';
  return titleCase(token);
}

export function formatModelDisplayName(modelId?: string | null): string | null {
  if (!modelId) return null;
  const base = normalizeBaseModelId(modelId);
  if (!base) return null;
  const normalized = base.toLowerCase();

  const claudeLabel = formatClaudeFamily(normalized);
  if (claudeLabel) return claudeLabel;

  const gptCodexLabel = formatGptCodex(normalized);
  if (gptCodexLabel) return gptCodexLabel;

  const tokens = normalized.replace(/_/g, '-').split('-').filter(Boolean);
  const filtered = tokens.filter((token) => token !== 'claude');
  const displayTokens = filtered.map((token) => normalizeToken(token));
  const label = displayTokens.join(' ').trim();
  return label || base;
}
