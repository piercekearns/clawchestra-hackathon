export type UpstreamFailureClassification = {
  type: 'rate_limit' | 'upstream_failure';
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
