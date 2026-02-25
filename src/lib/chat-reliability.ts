import type { AuthProfileCooldown } from './tauri';
import { getOpenclawAuthCooldowns } from './tauri';

export interface RateLimitCooldownInfo {
  profileId: string;
  provider: string;
  cooldownUntil: number;
  remainingMs: number;
  remainingFormatted: string;
}

export function formatCooldownRemaining(ms: number): string {
  if (ms <= 0) return 'expired';
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  if (seconds === 0) return `${minutes}m`;
  return `${minutes}m ${seconds}s`;
}

/**
 * After classifying an error as rate_limit, call this to fetch
 * the actual cooldown state from auth-profiles.json.
 * Returns the profile with the longest active cooldown, or null.
 */
export async function fetchRateLimitCooldownInfo(): Promise<RateLimitCooldownInfo | null> {
  try {
    const cooldowns: AuthProfileCooldown[] = await getOpenclawAuthCooldowns();
    const now = Date.now();

    const active = cooldowns
      .filter((c) => c.cooldownUntil !== null && c.cooldownUntil > now)
      .sort((a, b) => (b.cooldownUntil ?? 0) - (a.cooldownUntil ?? 0));

    if (active.length === 0) return null;

    const worst = active[0];
    const remainingMs = worst.cooldownUntil! - now;
    return {
      profileId: worst.profileId,
      provider: worst.provider,
      cooldownUntil: worst.cooldownUntil!,
      remainingMs,
      remainingFormatted: formatCooldownRemaining(remainingMs),
    };
  } catch (err) {
    console.warn('[chat-reliability] Failed to fetch cooldown info:', err);
    return null;
  }
}

export type UpstreamFailureClassification = {
  type: 'rate_limit' | 'monitor_timeout' | 'upstream_failure';
  title: string;
  action: string;
};

export function classifyUpstreamFailure(message: string): UpstreamFailureClassification {
  const normalized = message.toLowerCase();
  const isRateLimit =
    normalized.includes('429') ||
    normalized.includes('rate limit') ||
    normalized.includes('too many requests');
  if (isRateLimit) {
    return {
      type: 'rate_limit',
      title: 'Rate limit reached',
      action: 'Wait briefly, then retry',
    };
  }

  const isMonitoringTimeout =
    normalized.includes('openclaw chat aborted') ||
    normalized.includes('chat aborted') ||
    normalized.includes('monitoring turn timed out') ||
    (normalized.includes('timed out') && normalized.includes('background'));
  if (isMonitoringTimeout) {
    return {
      type: 'monitor_timeout',
      title: 'Background monitoring timed out',
      action: 'Check the tmux/background session; work may still be running',
    };
  }

  return {
    type: 'upstream_failure',
    title: 'Background task failed',
    action: 'Check logs for details',
  };
}

export function buildFailureBubbleDedupeKey(
  type: UpstreamFailureClassification['type'],
  runId?: string,
  sessionKey?: string,
): string {
  return `${type}:${runId ?? 'no-run'}:${sessionKey ?? 'no-session'}`;
}

export function shouldParseAssistantContentForSessionDiscovery(
  activityStrictSources: boolean,
): boolean {
  return !activityStrictSources;
}
