import { test } from 'node:test';
import assert from 'node:assert/strict';
import { changelog, compareVersions, latest, parseReleases, source, type GitHubRelease } from './releases.ts';

const asset = (tag: string, name: string) => ({
  name,
  browser_download_url: `https://github.com/christoph-teichmeister/shub/releases/download/${tag}/${name}`,
});
const release = (tag: string, prerelease = false, draft = false): GitHubRelease => ({
  tag_name: tag,
  prerelease,
  draft,
  body: `Notes ${tag}`,
  assets: [asset(tag, 'SHA256SUMS')],
});

// Shaped like GET /repos/:owner/:repo/releases (newest first by date, which is not always version order).
const FIXTURE: GitHubRelease[] = [
  release('v2026.11.0-beta.2', true),
  release('v2026.11.0-beta.10', true),
  release('v2026.12.0', false, true), // draft: never offered
  release('v2026.10.2'),
  release('nightly', true), // not a version tag
  release('v2026.10.1'),
  release('v2026.9.0'),
];

test('versions sort like semver: CalVer numbers, a pre-release before its release', () => {
  const sorted = ['2026.10.1', '2026.11.0-beta.2', '2026.9.3', '2026.11.0', '2026.11.0-beta.10', '2026.10.0'].sort(
    compareVersions,
  );
  assert.deepEqual(sorted, [
    '2026.9.3',
    '2026.10.0',
    '2026.10.1',
    '2026.11.0-beta.2',
    '2026.11.0-beta.10',
    '2026.11.0',
  ]);
  assert.throws(() => compareVersions('2026.10', '2026.10.0'), /not a version/);
});

test('channel selection: stable is the newest release, beta the newest including pre-releases', () => {
  const releases = parseReleases(FIXTURE);
  assert.deepEqual(
    releases.map((r) => r.version),
    ['2026.11.0-beta.10', '2026.11.0-beta.2', '2026.10.2', '2026.10.1', '2026.9.0'],
  );
  assert.equal(latest(releases, 'stable')?.version, '2026.10.2');
  assert.equal(latest(releases, 'beta')?.version, '2026.11.0-beta.10');
  assert.equal(latest(parseReleases([release('v1.0.0-beta.1', true)]), 'stable'), null);
  assert.equal(releases[0].assets.get('SHA256SUMS'), asset('v2026.11.0-beta.10', 'SHA256SUMS').browser_download_url);
});

test('changelog: the notes between the running and the new version on the channel', () => {
  const releases = parseReleases(FIXTURE);
  assert.equal(
    changelog(releases, 'stable', '2026.9.0', '2026.10.2'),
    '## 2026.10.2\n\nNotes v2026.10.2\n\n## 2026.10.1\n\nNotes v2026.10.1',
  );
  assert.match(
    changelog(releases, 'beta', '2026.10.2', '2026.11.0-beta.10'),
    /^## 2026\.11\.0-beta\.10[\s\S]*## 2026\.11\.0-beta\.2[^#]*$/,
  );
});

test('downloads only from the GitHub releases of the repository; local sources only for tests', async () => {
  const github = source({});
  await assert.rejects(github.download('https://example.com/shub.tar.gz', '/dev/null'), /refusing to download/);
  await assert.rejects(
    github.download('https://github.com/someone-else/shub/releases/download/v1/x', '/dev/null'),
    /refusing to download/,
  );
  assert.equal(await github.testKeys(), null);
  assert.throws(
    () => source({ SHUB_TEST_RELEASES: 'https://example.com/' }),
    /must be a file:\/\/ or http:\/\/127\.0\.0\.1/,
  );
  assert.doesNotThrow(() => source({ SHUB_TEST_RELEASES: 'http://127.0.0.1:8080/fixture' }));
});
