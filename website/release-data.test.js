import { describe, expect, test } from 'bun:test';

import {
  buildDownloadModel,
  choosePreferredAsset,
  chooseRelease,
  classifyAsset,
  detectPlatform,
} from './release-data.js';

describe('detectPlatform', () => {
  test('detects macOS', () => {
    expect(detectPlatform({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)', platform: 'MacIntel' })).toBe('macos');
  });

  test('detects Windows', () => {
    expect(detectPlatform({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', platform: 'Win32' })).toBe('windows');
  });

  test('detects Linux', () => {
    expect(detectPlatform({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64)', platform: 'Linux x86_64' })).toBe('linux');
  });
});

describe('classifyAsset', () => {
  test('recognises supported artifacts', () => {
    expect(classifyAsset({ name: 'Clawchestra_0.1.0_aarch64.dmg' })).toEqual({
      platform: 'macos',
      type: 'dmg',
      label: '.dmg installer',
    });
    expect(classifyAsset({ name: 'Clawchestra_0.1.0_x64_en-US.msi' })).toEqual({
      platform: 'windows',
      type: 'msi',
      label: '.msi installer',
    });
    expect(classifyAsset({ name: 'Clawchestra_0.1.0_amd64.AppImage' })).toEqual({
      platform: 'linux',
      type: 'appimage',
      label: '.AppImage',
    });
  });
});

describe('chooseRelease', () => {
  test('prefers prereleases with assets', () => {
    const release = chooseRelease([
      { draft: false, prerelease: false, assets: [{ name: 'stable.dmg' }] },
      { draft: false, prerelease: true, assets: [{ name: 'alpha.dmg' }] },
    ]);

    expect(release.prerelease).toBe(true);
  });
});

describe('choosePreferredAsset', () => {
  const assets = [
    { name: 'Clawchestra_0.1.0_aarch64.dmg', browser_download_url: 'https://example.com/app.dmg' },
    { name: 'Clawchestra_0.1.0_x64_en-US.msi', browser_download_url: 'https://example.com/app.msi' },
    { name: 'Clawchestra_0.1.0_amd64.AppImage', browser_download_url: 'https://example.com/app.appimage' },
    { name: 'Clawchestra_0.1.0_amd64.deb', browser_download_url: 'https://example.com/app.deb' },
  ];

  test('chooses a platform-specific primary artifact', () => {
    expect(choosePreferredAsset(assets, 'macos')?.name).toContain('.dmg');
    expect(choosePreferredAsset(assets, 'windows')?.name).toContain('.msi');
    expect(choosePreferredAsset(assets, 'linux')?.name).toContain('.AppImage');
  });
});

describe('buildDownloadModel', () => {
  test('builds grouped assets and primary choice', () => {
    const model = buildDownloadModel(
      {
        tag_name: 'app-v0.1.0-alpha.2',
        prerelease: true,
        published_at: '2026-03-06T00:00:00Z',
        html_url: 'https://example.com/release',
        body: 'Alpha release',
        assets: [
          { name: 'Clawchestra_0.1.0_aarch64.dmg', browser_download_url: 'https://example.com/app.dmg' },
          { name: 'Clawchestra_0.1.0_x64_en-US.msi', browser_download_url: 'https://example.com/app.msi' },
        ],
      },
      'windows',
    );

    expect(model.preferredAsset?.name).toContain('.msi');
    expect(model.groupedAssets.macos).toHaveLength(1);
    expect(model.groupedAssets.windows).toHaveLength(1);
  });

  test('normalizes untagged release urls back to the tag url', () => {
    const model = buildDownloadModel(
      {
        tag_name: 'app-v0.1.0-alpha.2',
        prerelease: true,
        created_at: '2026-03-06T00:00:00Z',
        html_url: 'https://github.com/piercekearns/clawchestra/releases/tag/untagged-bf2ec1528cd5531b1693',
        body: '',
        assets: [],
      },
      'unknown',
    );

    expect(model.releaseUrl).toBe('https://github.com/piercekearns/clawchestra/releases/tag/app-v0.1.0-alpha.2');
    expect(model.publishedAt).toBe('2026-03-06T00:00:00Z');
  });
});
