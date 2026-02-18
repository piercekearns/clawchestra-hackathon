export interface CommitActivity {
  lastCommit?: string;
  commitsThisWeek: number;
}

interface GitHubCommit {
  commit?: {
    author?: {
      date?: string;
    };
  };
}

const GITHUB_API = 'https://api.github.com';

// --- In-memory cache ---
// GitHub unauthenticated rate limit: 60 req/hr.
// With 4 repos × 2 calls each, a 5-minute TTL means ≈96 calls/hr max.
// A 10-minute TTL keeps us well under at ≈48/hr.
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const commitActivityCache = new Map<string, { data: CommitActivity; fetchedAt: number }>();

/**
 * Fetch commit activity for a GitHub repo.
 * Results are cached in memory for CACHE_TTL_MS to stay well under
 * GitHub's unauthenticated rate limit (60 req/hr).
 */
export async function fetchCommitActivity(repoSlug: string): Promise<CommitActivity | undefined> {
  if (!repoSlug) return undefined;

  // Return cached if fresh
  const cached = commitActivityCache.get(repoSlug);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.data;
  }

  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  try {
    const commitsResponse = await fetch(
      `${GITHUB_API}/repos/${repoSlug}/commits?since=${encodeURIComponent(since)}&per_page=100`,
      {
        headers: {
          Accept: 'application/vnd.github+json',
        },
      },
    );

    if (!commitsResponse.ok) {
      // On rate limit (403) or other errors, return stale cache if available
      if (cached) return cached.data;
      return undefined;
    }

    const commits = (await commitsResponse.json()) as GitHubCommit[];

    const latestResponse = await fetch(`${GITHUB_API}/repos/${repoSlug}/commits?per_page=1`, {
      headers: {
        Accept: 'application/vnd.github+json',
      },
    });

    let lastCommit: string | undefined;
    if (latestResponse.ok) {
      const latest = (await latestResponse.json()) as GitHubCommit[];
      const rawDate = latest[0]?.commit?.author?.date;
      if (rawDate) {
        lastCommit = rawDate.split('T')[0];
      }
    }

    const result: CommitActivity = {
      lastCommit,
      commitsThisWeek: commits.length,
    };

    commitActivityCache.set(repoSlug, { data: result, fetchedAt: Date.now() });
    return result;
  } catch {
    // On network error, return stale cache if available
    if (cached) return cached.data;
    return undefined;
  }
}

/** Force-expire the cache (e.g. after a push). */
export function invalidateCommitActivityCache(repoSlug?: string): void {
  if (repoSlug) {
    commitActivityCache.delete(repoSlug);
  } else {
    commitActivityCache.clear();
  }
}
