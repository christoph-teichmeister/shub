# Releasing

**Merge into `develop` = beta, merge into `main` = stable.** Nothing else to do: no version bump, no tag by hand.

## What happens on a merge

`.github/workflows/release.yml` runs on every push to `develop` and `main`:

1. **checks**: the `ci` workflow (typecheck, lint, tests, build, smoke test). Nothing is released if it fails.
2. **version**: `scripts/release/release.ts version` computes the version from the existing `v*` tags:
   - stable (`main`): `YYYY.M.MICRO`, MICRO the next free number for the current year and month (UTC) among the
     stable tags. First release in October 2026: `2026.10.0`, then `2026.10.1`, in November `2026.11.0`.
   - beta (`develop`): the next stable version plus `-beta.N`, N counting up per merge: `2026.10.2-beta.1`,
     `2026.10.2-beta.2`, ... After `2026.10.2` ships, betas continue with `2026.10.3-beta.1`.
   - A commit that already has its tag (a re-run) gets no new release.
3. **build**, one job per platform on native runners (`linux-x64`, `linux-arm64`, `darwin-arm64`, `darwin-x64`):
   `npm ci`, `npm run build`, `release.ts pack` writes `shub-<version>-<platform>.tar.gz` with `server/`, `shared/`,
   `cli/`, `web/dist/`, `package.json` (with the computed version), `release-keys.pem` and the production
   `node_modules` (node-pty built for that platform). The dry run (below) then installs and starts that archive once.
4. **publish**, in the GitHub environment `release`: `release.ts sign` writes `SHA256SUMS` over the archives and the bundle manifests (`shub-<version>-<target>.bundle.json`, see below) and
   `SHA256SUMS.sig` (base64 ed25519 signature of it) with the secret `SHUB_RELEASE_SIGNING_KEY`; `release.ts changelog`
   groups the Conventional Commits since the previous tag of the same channel; `gh release create v<version>
--target <sha>` creates the tag and the release (beta as pre-release).

The `version` in `package.json` is not used for releases; it is what a git checkout reports. Releases run one at a
time per branch (`concurrency: release-<ref>`). GitHub keeps only the newest waiting run of a branch, so if several
merges into it queue up, the older waiting one is skipped and its changes ship with the next release; a develop merge
never skips a waiting stable release. Tags are never moved or deleted (a ruleset forbids it): a broken release is
fixed by the next one, and installed shubs roll back on their own if it does not start.

## Signing key

The private key is the environment secret `SHUB_RELEASE_SIGNING_KEY` of the environment `release` (PEM, ed25519;
allowed branches `main` and `develop`). Public keys are in `launcher/release-keys.pem`, the one list that ships in the
launcher package and in every release archive. `release.ts sign` refuses a key whose public half is not in that file.

A new key pair:

```sh
openssl genpkey -algorithm ed25519 -out shub-release.pem
openssl pkey -in shub-release.pem -pubout       # add this block to launcher/release-keys.pem
gh secret set SHUB_RELEASE_SIGNING_KEY --env release -R christoph-teichmeister/shub < shub-release.pem
shred -u shub-release.pem                       # or keep it offline, e.g. in a password manager
```

The launcher accepts a SUMS signature from any key in its own `release-keys.pem` or in the `release-keys.pem` of the
installed app version.

### Rotating the key

- **Planned rotation**: add the new public key to `launcher/release-keys.pem` (keep the old one) and merge. That
  release is still signed with the old key and carries the new key inside its archive; once users have updated to it,
  their launchers trust both. Then set the secret to the new private key. Later, remove the old key from the file and
  publish a new launcher, so fresh installs do not trust it either.
- **Old key lost**: add the new key and remove the old one in `launcher/release-keys.pem`, set the secret, and
  publish a new launcher version. Installed launchers cannot verify releases signed with the new key, so users
  reinstall the launcher: `npm i -g @christoph-teichmeister/shub@latest`; its bundled keys verify the next update.
- **Old key leaked**: as for a lost key. Until a user has updated to a version without the old key, a release signed
  with the leaked key would still be accepted through the installed version's `release-keys.pem`, so say so in the
  release notes.

## The launcher on npm

`launcher/` is the npm package `@christoph-teichmeister/shub` (bin `shub`) with its own semver line, started at
`1.0.0` and independent of the app's CalVer. It is published by hand, not by the release workflow:

```sh
cd launcher && npm version patch && npm publish --access public
```

`prepack` builds `dist/` with `tsc`: Node refuses to strip TypeScript types under `node_modules`, so the package
ships JavaScript. The package name is set only in `launcher/package.json` (and the install line in the README).

## Locally

```sh
npm run build && npm run release:dry-run
```

The dry run packs the archive for this machine, signs it with a throwaway key, serves it as a local release, installs
the packed launcher into a temp npm prefix, runs `shub doctor`, `shub install` and `shub start` with a temp
`SHUB_HOME`, config and state dirs, a free port and the tmux socket `shub-dry-<pid>`, checks `/api/health` and
`shub status`, stops it and kills only that tmux socket. `--archive <file>` uses an existing archive (CI does).

The other steps work on their own too: `node scripts/release/release.ts version --branch develop`,
`... changelog --channel beta`, `... pack --version 2026.10.0-beta.1 --out release`.

`SHUB_TEST_RELEASES` (a `file://` or `http://127.0.0.1` URL of a folder with `releases.json` in the shape of the GitHub
releases API and a `release-keys.pem`) points the launcher at such a local release instead of GitHub. Tests only.

## Web bundle for phone apps

`release.ts pack` also writes `web/dist/bundle.json` into each archive (version, API version, SHA-256 of every web
file except the loader `sw.js`, `loader.js`, `release-keys.js`) and the same file next to the archive as
`shub-<version>-<target>.bundle.json`, which `SHA256SUMS` lists. A running shub offers it at `GET /api/bundle` together
with its release's `SHA256SUMS` and `.sig` (fetched once from the GitHub release, cached in `<stateDir>/release/<version>/`).
A phone app's loader (`web/public/sw.js`) takes another machine's web app only when that signature checks out against
`release-keys.js`, which the build generates from `launcher/release-keys.pem`. Rotating a key therefore also needs a
build that phone apps install from their own machine first.
The loader opens the app network first from the machine it was installed from (4 s), and falls back to the cached bundle
only when that machine is off, so a phone app does not run an old UI while its machine is reachable.
