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
