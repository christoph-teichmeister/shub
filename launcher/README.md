# shub launcher

Installs, updates and starts [shub](https://github.com/christoph-teichmeister/shub), your session hub: all your
Claude Code sessions in one window. Linux and macOS (Windows only inside WSL2), Node 24+, tmux 3.3+, Claude Code.

```sh
npm i -g @christoph-teichmeister/shub && shub install
```

| Command                                  | What it does                                                                  |
| ---------------------------------------- | ----------------------------------------------------------------------------- |
| `shub` / `shub start`                    | runs the installed version                                                    |
| `shub install`                           | guided setup: checks, channel, port, release, service, access token           |
| `shub install --yes [--channel beta]`    | no questions: downloads and installs the latest release (scripts, CI)         |
| `shub token`                             | prints the access token to log in with                                        |
| `shub update [--to <version>] [--check]` | installs a newer release and restarts shub; rolls back if it does not come up |
| `shub rollback`                          | switches back to the previous version                                         |
| `shub service install\|uninstall`        | systemd user unit (Linux) or launchd agent (macOS)                            |
| `shub doctor`                            | checks Node, tmux, Claude Code, Docker and the port                           |

Every other command (`shub status`, `shub session start`, ...) goes to the installed version's CLI.

Releases are verified before they are installed: the archive's SHA-256 must be in a `SHA256SUMS` signed with the
shub release key (`release-keys.pem`). Versions live in `~/.local/share/shub/versions/` (`SHUB_HOME`), `current`
points at the active one, the last two stay for rollback.
