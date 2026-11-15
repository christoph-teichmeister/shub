# Troubleshooting

Start with `shub doctor`: it checks Node, tmux, Claude Code, Docker and the port and says what is missing.
Back to the [README](../README.md).

## shub is not reachable

`shub status` says "shub is not reachable". Which case are you in?

- **Never started, or run from a git checkout**: `shub start` (installed) or `npm start` (checkout).
- **Linux, installed as a service** (systemd user unit): `systemctl --user status shub`, logs with
  `journalctl --user -u shub -f`, restart with `systemctl --user restart shub`. To keep it running while you are
  logged out: `loginctl enable-linger $USER`.
- **macOS, installed as a service** (launchd agent): `launchctl print gui/$(id -u)/com.github.christoph-teichmeister.shub`;
  the log is `shub.log` in `~/.local/share/shub/` (`SHUB_HOME`).
- **No service yet**: `shub service install` runs shub in the background and starts it with your login.
- **Other port**: the CLI looks at `http://127.0.0.1:4780`; for another port set `SHUB_URL=http://127.0.0.1:4781`.

## The port is in use

`shub doctor` says "127.0.0.1:4780 is used by another program". Stop that program, or run shub on another port:

```sh
SHUB_PORT=4781 shub start
```

For the background service, install it again with the port set (it is stored in the unit):
`SHUB_PORT=4781 shub service install`.

## tmux or Claude Code is missing

- tmux 3.3 or newer: `sudo apt install tmux` (or dnf, pacman), `brew install tmux` on macOS.
- Claude Code: `npm i -g @anthropic-ai/claude-code`, then run `claude` once in a terminal and log in.
  Starting a session without it fails with "Claude Code not found".
- Installed but still not found by the service: the service keeps the `PATH` it had when it was installed. Run
  `shub service install` again from a terminal where `claude` works. When shub starts a session it also looks in `~/.local/bin`; `shub doctor` does not.

## A session is stuck

- Paused after a reboot or restart: open it and press "Wake it up?".
- Claude is waiting for a keypress you cannot see: the terminal is the real Claude, click into it and answer.
- Parked as waiting but the thing already happened: `shub session ready` in that session ends the wait.
- Nothing helps: close it (`Alt W`, or `shub session close <session id>`; ids from `shub session list`) and start a
  new one.
- To look at the raw terminal: `tmux -L shub attach -t shub-<session id>` (detach with `Ctrl+B D`).

## The needs-you badge does not show

shub learns a session's state from Claude Code hooks. It adds them to every session it starts (a settings file passed to
`claude --settings`), so only sessions started by shub report.

- A `claude` you started in some other terminal is not tracked. In a shub terminal, `claude` (or the "Start Claude
  here" button) opens a tracked session.
- The hook script uses `curl`: check that `curl --version` works.
- `shub doctor` shows whether shub itself answers on its port.

## I lost the access token

- `shub token` prints it again (it lives in `token` in shub's state folder, `~/.local/state/shub/` unless `SHUB_STATE_DIR` or `XDG_STATE_HOME` moves it).
- Signed in somewhere already: Settings > Account & security > Rotate access token writes a new one and signs out
  every other browser and phone.
