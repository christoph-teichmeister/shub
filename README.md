<p align="center"><img src="docs/banner.png" alt="shub_ — your session hub" width="720"></p>

# shub — your session hub

All your Claude Code sessions in one window, grouped by project. shub runs the real Claude Code CLI in tmux on your
machine and shows it in the browser: one tab per session, a badge when a session needs you, the Docker services of the
session's worktree next to it, and a phone view to answer permission questions on the go.

> Status: early. Version scheme: CalVer `YYYY.M.MICRO`.

## What it does

- **Projects** with a folder, a group and an icon (detected from the git remote). Pinned ones live in the sidebar,
  dormant ones are one `Alt K` away.
- **Sessions** are real `claude` processes in tmux (`tmux -L shub`). They survive closing the browser and restarting
  shub; after a reboot shub offers to resume them.
- **Status** per session from Claude Code hooks: _needs you_, _your turn_, _working_. Desktop notifications and web push.
- **Waiting**: park a session (tab menu > Wait for…, or `shub session wait`) until something outside happens; optionally Haiku checks it read-only in the background and hands the session back when it did.
- **Buttons** for your skills: shub lists the project's and your global Claude skills; tick the ones you want as buttons.
- **Permission mode** for new sessions in Settings (default `default`; `auto` and the like skip prompts, `inherit` uses your Claude settings); a button's own mode wins.
- **Worktrees** button on every project: search its worktrees by name, branch or state (merged, remote gone, dirty, not pushed, …), open a terminal or a Claude session in one, or close it: through the project's `/worktree-close` button when it has one, else plain git that never forces.
- **Services panel** with the Docker Compose containers of the session's folder or worktree, PyCharm style.
- **Plain terminals** as their own tab (`Alt T`; "Start Claude here" or `shub claude` opens Claude in the folder you cd-ed to) or below a session (`Alt Shift T`).
- **Global Claude**: one session not tied to a project, for quick questions or setting up new projects.
- **Phone**: install as a PWA over Tailscale, pair with a QR code, answer permission prompts with one tap.
- **Themes**: Monokai, Dracula, Neutral dark, or your own.
- **Plugins** in any language, talking to shub's HTTP/WebSocket API. See [docs/PLUGINS.md](docs/PLUGINS.md).

## Requirements

Linux or macOS, Node 24+, tmux 3.3+, Claude Code, optionally Docker and Tailscale. Windows only inside WSL2: install
and run shub there.

## Install

```sh
npm i -g @christoph-teichmeister/shub && shub install
```

The npm package is only the launcher (`shub`). In a terminal, `shub install` walks you through the setup: it checks
Node, tmux and Claude Code (and says how to install what is missing), asks for the update channel, port and an optional
public URL, downloads the latest signed release from GitHub, runs it as a systemd user unit (Linux) or a launchd agent
(macOS) at http://127.0.0.1:4780 and prints the access token you log in with (`shub token` prints it again). For
scripts, `shub install --yes [--channel beta]` only installs the release, and `shub service install` adds the service.
`shub doctor` says what is missing. Versions live side by side in
`~/.local/share/shub/versions/` (`SHUB_HOME`); Settings > Updates checks as soon as a release is published (a push via ntfy.sh) and every 6 hours, shows new versions with their notes
and installs one when you click (or by itself with "Install automatically"; "off" skips the check), `shub update` and `shub rollback` do the same in a terminal. If a new version does not come up
within 30 seconds, the launcher switches back. Sessions keep running in tmux through updates. Every other command
(`shub status`, `shub session start`, ...) goes to the installed version. Releases: [docs/RELEASING.md](docs/RELEASING.md).

## Run from a git checkout

```sh
npm install
npm run build
npm start            # http://127.0.0.1:4780
```

Started like this, shub's updates are managed by git (Settings > Updates is read-only).

On first start shub creates an access token and prints the file it lives in. Open the URL, paste the token, done.
shub only ever listens on `127.0.0.1`. For your phone, Settings > Phone walks you through it: it checks Tailscale, runs
`tailscale serve` for shub (tailnet only, never Funnel), stores the address as `publicUrl` in `local.json` and shows the
pairing QR code. `SHUB_PUBLIC_URL` still works and wins over `publicUrl`. A systemd user unit example is in [deploy/shub.service](deploy/shub.service).

## Configuration

`~/.config/shub/config.json` holds projects, groups, buttons and themes and contains no secrets, so you can keep it in
your dotfiles and share it between machines:

- Project paths under your home are stored as `~/...`. A project whose folder is missing on a machine shows dimmed
  there and is never removed.
- shub reloads the file when it changes on disk (git pull, Syncthing, an editor). If it cannot be read (e.g. git
  conflict markers), shub keeps running on the last good config (a copy in `~/.local/state/shub/`, also used at
  startup), warns in the app and refuses changes until you fix the file, so the conflict is never overwritten.
- `~/.config/shub/local.json` (keep it out of your dotfiles) holds what stays on one machine; its keys win over
  `config.json`. The update channel always goes there; put any other key there (e.g. `"defaultPermissionMode"`) to make
  it machine-only.
- The systemd unit written by `shub service install` is machine-specific (absolute paths); keep it out of your dotfiles.

Secrets and runtime state live in `~/.local/state/shub/`.

## Security

shub is a full shell in a browser tab. Read [docs/SECURITY.md](docs/SECURITY.md) before exposing it to your phone. In
short: loopback only, Tailscale for remote access, a login on every request, and a permission model for Claude
sessions that use the `shub` command. Those rules only cover requests through shub; a session can still run commands
from its own shell, which only Claude Code's own permission prompts guard.

## Develop

```sh
npm run dev          # server with --watch
npm run web:dev      # Vite dev server, proxies /api to :4780
npm test             # node:test, including launcher/ and scripts/release/
npm run test:smoke   # Playwright
npm run release:dry-run   # pack, sign and install a release locally (after npm run build)
npm run typecheck && npm run lint
prek install --install-hooks   # pre-commit hooks (prek or pre-commit), tests on push
```

Architecture, the API contract and the style guide: [shared/api.ts](shared/api.ts), [docs/API.md](docs/API.md),
[docs/STYLEGUIDE.md](docs/STYLEGUIDE.md).

## License

MIT
