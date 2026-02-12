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

export async function fetchCommitActivity(repoSlug: string): Promise<CommitActivity | undefined> {
  if (!repoSlug) return undefined;

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

    if (!commitsResponse.ok) return undefined;

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

    return {
      lastCommit,
      commitsThisWeek: commits.length,
    };
  } catch {
    return undefined;
  }
}
