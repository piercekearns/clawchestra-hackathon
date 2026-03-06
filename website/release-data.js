const PLATFORM_ASSET_PRIORITIES = {
  macos: ['dmg', 'app-tarball'],
  windows: ['msi'],
  linux: ['appimage', 'deb'],
};

const PLATFORM_LABELS = {
  macos: 'macOS',
  windows: 'Windows',
  linux: 'Linux',
  unknown: 'your platform',
};

function normalizeReleaseUrl(release) {
  const rawUrl = String(release?.html_url ?? '').trim();
  const tagName = String(release?.tag_name ?? '').trim();

  if (!tagName) {
    return rawUrl;
  }

  if (rawUrl.includes('/releases/tag/untagged-') || rawUrl.length === 0) {
    return `https://github.com/piercekearns/clawchestra/releases/tag/${tagName}`;
  }

  return rawUrl;
}

export function detectPlatform({ userAgent = '', platform = '' } = {}) {
  const normalizedUserAgent = userAgent.toLowerCase();
  const normalizedPlatform = platform.toLowerCase();

  if (normalizedPlatform.includes('mac') || normalizedUserAgent.includes('mac os x')) {
    return 'macos';
  }

  if (normalizedPlatform.includes('win') || normalizedUserAgent.includes('windows')) {
    return 'windows';
  }

  if (
    normalizedPlatform.includes('linux') ||
    normalizedPlatform.includes('x11') ||
    normalizedUserAgent.includes('linux')
  ) {
    return 'linux';
  }

  return 'unknown';
}

export function classifyAsset(asset) {
  const name = String(asset?.name ?? '').toLowerCase();

  if (name.endsWith('.dmg')) {
    return { platform: 'macos', type: 'dmg', label: '.dmg installer' };
  }

  if (name.endsWith('.app.tar.gz')) {
    return { platform: 'macos', type: 'app-tarball', label: '.app tarball' };
  }

  if (name.endsWith('.msi')) {
    return { platform: 'windows', type: 'msi', label: '.msi installer' };
  }

  if (name.endsWith('.appimage')) {
    return { platform: 'linux', type: 'appimage', label: '.AppImage' };
  }

  if (name.endsWith('.deb')) {
    return { platform: 'linux', type: 'deb', label: '.deb package' };
  }

  return null;
}

export function choosePreferredAsset(assets, detectedPlatform) {
  const supportedAssets = assets
    .map((asset) => {
      const classification = classifyAsset(asset);
      if (!classification) {
        return null;
      }

      return {
        ...asset,
        classification,
      };
    })
    .filter(Boolean);

  if (detectedPlatform === 'unknown') {
    return null;
  }

  const desiredOrder = PLATFORM_ASSET_PRIORITIES[detectedPlatform] ?? [];
  return desiredOrder
    .map((desiredType) =>
      supportedAssets.find(
        (asset) =>
          asset.classification.platform === detectedPlatform && asset.classification.type === desiredType,
      ),
    )
    .find(Boolean) ?? null;
}

export function groupAssetsByPlatform(assets) {
  const grouped = {
    macos: [],
    windows: [],
    linux: [],
  };

  for (const asset of assets) {
    const classification = classifyAsset(asset);
    if (!classification) {
      continue;
    }

    grouped[classification.platform].push({
      ...asset,
      classification,
    });
  }

  return grouped;
}

export function chooseRelease(releases) {
  const withAssets = releases.filter(
    (release) => !release.draft && Array.isArray(release.assets) && release.assets.length > 0,
  );

  const prerelease = withAssets.find((release) => release.prerelease);
  if (prerelease) {
    return prerelease;
  }

  return withAssets[0] ?? null;
}

export function buildDownloadModel(release, detectedPlatform) {
  if (!release) {
    return null;
  }

  const groupedAssets = groupAssetsByPlatform(release.assets ?? []);
  const preferredAsset = choosePreferredAsset(release.assets ?? [], detectedPlatform);

  return {
    tagName: release.tag_name,
    publishedAt: release.published_at ?? release.created_at ?? null,
    prerelease: Boolean(release.prerelease),
    releaseName: release.name || release.tag_name,
    releaseUrl: normalizeReleaseUrl(release),
    body: String(release.body ?? '').trim(),
    groupedAssets,
    preferredAsset,
    detectedPlatform,
    detectedPlatformLabel: PLATFORM_LABELS[detectedPlatform] ?? PLATFORM_LABELS.unknown,
  };
}
