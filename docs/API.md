# shub HTTP API

The contract lives in `shared/api.ts` (types, `ROUTES`, `ServerEvent`). This page explains how to use it.
shub listens on `127.0.0.1:4780` only; phones reach it through `tailscale serve` (`SHUB_PUBLIC_URL`).

## Versions

- **App version** is CalVer `YYYY.M.MICRO` (e.g. `2026.10.0`): year, month without zero padding, and a counter of
  releases within that month, starting at 0. It stays semver-valid. Source: `package.json`. Reported by
  `shub --version` and `GET /api/health`.
- **`API_VERSION`** (an integer in `shared/api.ts`, sent in `hello` and `/api/health`) is separate and only changes
  on a breaking API change. Adding routes, fields or event types is not breaking; clients ignore what they do not know.

## Auth

| Client                  | How                                                                                                                                                                                                | Caller kind                                 |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Browser (desktop)       | `POST /api/auth/login {token, deviceName?}` with the access token; sets cookie `shub_session`                                                                                                      | `user`                                      |
| Phone                   | `POST /api/auth/pairing` (logged-in user) returns `{code, url, qrSvg, expiresAt}`; the phone opens `url` (`/pair/<code>`) and the web app calls `POST /api/auth/pairing/redeem {code, deviceName}` | `user`                                      |
| CLI with the token file | `Authorization: Bearer <access token>`                                                                                                                                                             | `cli`                                       |
| Claude session / plugin | `Authorization: Bearer <client token>` (issued by shub, e.g. `SHUB_TOKEN` in sessions)                                                                                                             | `session`, `spawned-session`, `plugin`, ... |

- The access token is 32 random bytes (hex) in `<stateDir>/token` (`~/.local/state/shub/token`, mode 0600), created
  on first start. Only its path is ever logged.
- The cookie is `HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000` (30 days), plus `Secure` behind
  `x-forwarded-proto: https`. Each cookie is a device (`GET /api/devices`, `DELETE /api/devices/:id`).
- Pairing codes are single use and valid 5 minutes.
- `POST /api/auth/rotate` writes a new access token to the file and signs out every device except the caller's.
  Client tokens stay valid. The response `{ok, token, tokenFile}` is the only place the new token is shown
  (`no-store`, never logged); afterwards it is only in the file.
- `GET /api/auth/me` returns `{caller, device}`; `POST /api/auth/logout` removes the caller's device.
- Rights of every caller come from the permission module at request time (`docs/SECURITY.md`).
  Routes that change things go through `permissions.decide`; an "ask" decision answers `200 {approval}` and the
  change is applied once the user approves it.

### Request guard

- `Host` must be `127.0.0.1:<port>`, `localhost:<port>` or the host of `SHUB_PUBLIC_URL`, else `403` (DNS rebinding).
- A foreign `Origin` is always refused. Requests that carry a cookie and change state (not GET/HEAD/OPTIONS), and
  every WebSocket upgrade with a cookie, must send an allowed `Origin` (CSRF). Bearer clients send neither.
- No login needed: `GET /api/health`, `POST /api/auth/login`, `POST /api/auth/pairing/redeem`, the static web app.
  `/api/hooks/*` and `/api/guard` authenticate with the session's client token instead of a cookie.

## Requests and errors

JSON in, JSON out (`content-type: application/json`). Errors: `{ "error": "<message>" }` with the HTTP status
(`400` bad input, `401` login required, `403` refused, `404` unknown, `409` conflict, `413` body too large,
`500` internal). A handler that returns nothing answers `204`.

## Routes

All routes are in `ROUTES` in `shared/api.ts`. Notes on the ones that are not obvious:

| Route                             | Body / result                                                                                                                                                                                                                        |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/health`                 | `{ok, version, apiVersion}`                                                                                                                                                                                                          |
| `GET /api/config`                 | `Config` (needs `read`)                                                                                                                                                                                                              |
| `GET /api/projects`               | `ProjectView[]`, sorted by `order`; `resolvedIcon` from the git remote for `auto` icons; `remoteUrl` is the `origin` remote as a browser URL, when there is one; `accent` is the symbol colour or `#f92672`, never the status orange |
| `POST /api/projects`              | `{name, path, group?, visibility?, icon?, buttons?}` -> `ProjectView`; `path` must be an existing absolute folder; an `image` icon's `path` is a `data:image/` or `https://` URL; new groups are added to `groups`                   |
| `PATCH /api/projects/:id`         | any of the same fields plus `mainCheckout` (`{branch, updateMinutes}` with 0 to 1440, `null` switches it off); changing `buttons` is also checked as `buttons.write`                                                                 |
| `POST /api/projects/reorder`      | `{ids: string[]}` -> `ProjectView[]`; unlisted projects keep their relative order after the listed ones                                                                                                                              |
| `DELETE /api/projects/:id`        | removes the entry only, never the folder                                                                                                                                                                                             |
| `GET /api/projects/import`        | `{path, name, sessions, lastUsedAt, suggested: 'pinned'                                                                                                                                                                              | 'dormant', resolvedIcon}[]`from`~/.claude/projects`; worktrees merged, configured and vanished paths left out; pinned = used in the last 14 days |
| `GET /api/folders`                | user only: `?path=` (absolute, default home) -> `{path, parent, folders}`, the non-hidden subfolders on the shub machine, for the folder picker                                                                                      |
| `PUT /api/themes/:id`             | `{name, base?, tokens}` -> `ThemeDef`; built-in themes (`monokai`, `dracula`, `neutral-dark`) are read-only                                                                                                                          |
| `PATCH /api/settings`             | `{activeTheme?, groups?, notifications?}` -> `Config`                                                                                                                                                                                |
| `GET /api/projects/:id/skills`    | `SkillInfo[]`: `<project>/.claude/skills`, `~/.claude/skills`, plugin skills (`<plugin>:<skill>`)                                                                                                                                    |
| `POST /api/guard`                 | PreToolUse hook input -> `{}`, or a `deny` decision when the call would edit files in, or switch/commit/rebase/reset/stash, the project's protected main checkout (worktrees inside it stay allowed); session token only             |
| `GET /api/projects/:id/worktrees` | `Worktree[]` (`{path, branch}`) from `git worktree list --porcelain`; `branch` is `""` when detached, bare and pruned entries are left out, `[]` for a non-git folder                                                                |
| `POST /api/sessions`              | `StartSessionRequest`; `resumeClaudeSessionId` (kind `claude`, an id from `old-sessions`, no prompt or button) reopens that conversation with `--resume`                                                                             |
| `GET /api/plugins/:name/logs`     | `{lines: string[]}`, user only                                                                                                                                                                                                       |
| `DELETE /api/plugins/:name`       | user only: stops the plugin, drops its config entry and deletes its folder                                                                                                                                                           |
| `GET /api/updates`                | `UpdateStatus`: running version, channel, mode, newer release and its notes, last check, the launcher's last result; `managedBy: 'git'` from a checkout                                                                              |
| `POST /api/updates/install`       | `{version?}` (default: `latest`) -> `{ok, version}`; browser user only; runs `shub update --to <version>` of the launcher, which restarts shub                                                                                       |
| `POST /api/updates/rollback`      | -> `{ok, version}`; browser user only; runs `shub rollback`                                                                                                                                                                          |
| `PATCH /api/updates/channel`      | `{channel: 'stable'\|'beta'}` -> `UpdateStatus`; browser user only; stored as `updateChannel` in config and checked again                                                                                                            |
| `PATCH /api/updates/mode`         | `{mode: 'auto'\|'ask'\|'off'}` -> `UpdateStatus`; browser user only; stored as `updateMode` in config; `auto` installs a newer release after each check (on a release push from ntfy.sh, else every 6 h), `off` skips them           |

## Events

Every bus event the caller may read (needs `read`; `plugin.action` only reaches the user and that plugin), as
`ServerEvent` JSON. The first message is always `{"type":"hello","apiVersion":1}`.

- **WebSocket** `GET /api/events` (upgrade). One JSON event per text frame; the server pings every 30 s.
- **Server-Sent Events** `GET /api/events/stream` for clients without WebSocket: `data: <json>\n\n` per event,
  `: ping` comments every 25 s.

```sh
curl -N -H "Authorization: Bearer $SHUB_TOKEN" http://127.0.0.1:4780/api/events/stream
```

Other modules add their own WebSocket paths (e.g. `/api/terminals/:id`) through `onUpgrade()` in
`server/api/upgrade.ts`; the api module checks Host/Origin and auth before handing them the socket.

## CLI

`shub status | project list|show|add | session list|start|status | open`, `--json` for machine output,
`--help` per command. Talks to `SHUB_URL` (default `http://127.0.0.1:4780`) with `SHUB_TOKEN` or the token file.
Installed with the launcher (`launcher/`), `shub` is the launcher: it handles `start`, `install`, `update`,
`rollback`, `service` and `doctor` and passes every other command to this CLI of the installed version.
