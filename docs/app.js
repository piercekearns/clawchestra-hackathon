import {
  buildDownloadModel,
  chooseRelease,
  detectPlatform,
} from './release-data.js';

const RELEASES_API = 'https://api.github.com/repos/piercekearns/clawchestra-hackathon/releases';
const FALLBACK_MANIFEST = './release-manifest.json';

function formatReleaseDate(isoString) {
  if (!isoString) {
    return 'Date unavailable';
  }

  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return 'Date unavailable';
  }

  return new Intl.DateTimeFormat('en', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(date);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderReleaseNotes(body) {
  if (!body) {
    return '<p class="notes-empty">Release notes have not been written yet. Use the GitHub release page for the latest artifact list.</p>';
  }

  return body
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br />')}</p>`)
    .join('');
}

function renderAssetList(assets) {
  if (!assets.length) {
    return '<li class="asset-empty">No artifact published for this platform yet.</li>';
  }

  return assets
    .map(
      (asset) => `
        <li>
          <a href="${asset.browser_download_url}" target="_blank" rel="noreferrer">
            <span>${escapeHtml(asset.name)}</span>
            <span>${escapeHtml(asset.classification.label)}</span>
          </a>
        </li>
      `,
    )
    .join('');
}

function setState(state) {
  document.documentElement.dataset.state = state;
}

function setElementText(selector, value) {
  const element = document.querySelector(selector);
  if (element) {
    element.textContent = value;
  }
}

function setElementHref(selector, href) {
  const element = document.querySelector(selector);
  if (element) {
    element.href = href;
  }
}

function applyModel(model, { source }) {
  setElementText('[data-release-tag]', model.tagName);
  setElementText('[data-release-date]', formatReleaseDate(model.publishedAt));
  setElementText('[data-release-flavor]', model.prerelease ? 'prerelease' : 'stable');
  setElementHref('[data-release-url]', model.releaseUrl);
  setElementHref('[data-release-url-secondary]', model.releaseUrl);
  document.querySelector('[data-release-notes]').innerHTML = renderReleaseNotes(model.body);
  setElementText('[data-platform-label]', model.detectedPlatformLabel);
  setElementText('[data-release-source]', source);

  const installButton = document.querySelector('[data-primary-install]');
  const installLabel = document.querySelector('[data-primary-label]');
  const installMeta = document.querySelector('[data-primary-meta]');

  if (model.preferredAsset) {
    installButton.href = model.preferredAsset.browser_download_url;
    installButton.removeAttribute('aria-disabled');
    installButton.classList.remove('button-disabled');
    installLabel.textContent = `Download for ${model.detectedPlatformLabel}`;
    installMeta.textContent = `${model.preferredAsset.name} • ${model.preferredAsset.classification.label}`;
  } else {
    installButton.href = model.releaseUrl;
    installButton.setAttribute('aria-disabled', 'true');
    installButton.classList.add('button-disabled');
    installLabel.textContent = 'Open all release assets';
    installMeta.textContent = 'Automatic OS match unavailable for this device';
  }

  document.querySelector('[data-assets-macos]').innerHTML = renderAssetList(model.groupedAssets.macos);
  document.querySelector('[data-assets-windows]').innerHTML = renderAssetList(model.groupedAssets.windows);
  document.querySelector('[data-assets-linux]').innerHTML = renderAssetList(model.groupedAssets.linux);
}

async function fetchFallbackRelease() {
  const response = await fetch(FALLBACK_MANIFEST, {
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Fallback manifest returned ${response.status}`);
  }

  return response.json();
}

async function fetchPrimaryRelease() {
  const response = await fetch(RELEASES_API, {
    headers: {
      Accept: 'application/vnd.github+json',
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub API returned ${response.status}`);
  }

  const releases = await response.json();
  return chooseRelease(releases);
}

async function loadReleaseSurface() {
  const detectedPlatform = detectPlatform({
    userAgent: navigator.userAgent,
    platform: navigator.platform,
  });

  setElementText('[data-platform-chip]', detectedPlatform);
  setElementText('[data-platform-label]', detectedPlatform === 'unknown' ? 'your platform' : detectedPlatform);
  setElementText('[data-primary-label]', 'Loading latest artifact');
  setElementText('[data-primary-meta]', 'Trying live GitHub release metadata first…');
  setElementHref('[data-primary-install]', 'https://github.com/piercekearns/clawchestra-hackathon/releases');
  setElementHref('[data-release-url]', 'https://github.com/piercekearns/clawchestra-hackathon/releases');
  setElementHref('[data-release-url-secondary]', 'https://github.com/piercekearns/clawchestra-hackathon/releases');

  try {
    const liveRelease = await fetchPrimaryRelease();
    const liveModel = buildDownloadModel(liveRelease, detectedPlatform);

    if (!liveModel) {
      throw new Error('No published release with supported assets found');
    }

    applyModel(liveModel, { source: 'live GitHub API' });
    setState('ready');
    return;
  } catch (liveError) {
    console.warn('Live release lookup failed, falling back to checked-in manifest.', liveError);
  }

  try {
    const fallbackRelease = await fetchFallbackRelease();
    const fallbackModel = buildDownloadModel(fallbackRelease, detectedPlatform);

    if (!fallbackModel) {
      throw new Error('Fallback manifest did not contain a supported release');
    }

    applyModel(fallbackModel, { source: 'checked-in fallback manifest' });
    setState('ready');
    return;
  } catch (fallbackError) {
    console.error(fallbackError);
    setElementText(
      '[data-error-message]',
      'Could not load live release metadata or the fallback manifest. Use GitHub Releases directly while the install surface recovers.',
    );
    setElementText('[data-primary-label]', 'Open GitHub Releases');
    setElementText('[data-primary-meta]', 'Both live and fallback metadata paths failed');
    setState('error');
  }
}

loadReleaseSurface();
