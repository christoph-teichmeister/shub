# Security

shub controls Claude Code sessions, which can run shell commands as you. This page says what shub
protects against, the exact rules it enforces, and, just as important, what it does not protect against.

## Threat model

| Threat                                                                                                                       | Covered by                                                       |
| ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Someone on your network or the internet reaching shub                                                                        | Loopback-only bind, Tailscale for the phone                      |
| A web page in your browser talking to shub (CSRF, DNS rebinding)                                                             | Host and Origin allow-lists                                      |
| A Claude session (e.g. reviewing someone else's code) being talked into starting more sessions, changing buttons or projects | Permission rules, approvals, activity log                        |
| A runaway session or plugin starting sessions in a loop                                                                      | Rate limit, "one level deep"                                     |
| A plugin doing more than you agreed to                                                                                       | Per-plugin token with only the rights you granted                |
| Secrets showing up in the Docker panel                                                                                       | Env values with secret-looking keys and URL passwords are masked |

Not covered: anything a process does with your Unix user's rights outside shub. See [Honest scope](#honest-scope).

## Network and authentication

- shub listens on `127.0.0.1` only. The phone reaches it through `tailscale serve`; never put shub on `0.0.0.0` or behind a public proxy.
- Every request needs the `Host` to be loopback on shub's port or the host of `SHUB_PUBLIC_URL`. A foreign `Origin` is refused; a cookie request that changes state must carry an allowed `Origin`.
- **Access token** in `<stateDir>/token` (mode 0600). The browser exchanges it once for a device cookie; as a Bearer token it identifies the `cli` caller. Rotate it in Settings.
- **Phone pairing**: single-use QR code, valid five minutes, gives the phone its own device cookie.
- **Client tokens**: every Claude session and every plugin process gets its own Bearer token (`SHUB_TOKEN`), revoked when it ends. The token decides the caller kind; only the hashes are stored.

## Caller kinds

| Kind              | Who                                                     |
| ----------------- | ------------------------------------------------------- |
| `user`            | You in the browser or on the phone (device cookie)      |
| `cli`             | The access token, i.e. you in a terminal running `shub` |
| `global-claude`   | The global Claude session                               |
| `session`         | A normal project session                                |
| `spawned-session` | A session started by another session                    |
| `plugin`          | A plugin process                                        |

## Rules

The rules live in `server/permissions/rules.ts` as one pure `decide()` function with tests next to it.
Every decision is `allow`, `ask` (an approval card on the desktop and a push on the phone; the action waits up to 30 minutes, then counts as rejected) or `deny`.

- **user** may do everything. Only `user` can decide approvals, not even `cli`: the token file is readable by any process of your user, a device cookie is not.
- **cli** is like the user, except that it cannot decide approvals, its `buttons.write` asks and its session starts count towards the rate limit.
- **global-claude** may write projects and start sessions. A start through a configured button with simple input is allowed; a free prompt (or a button with non-simple input) asks.
- **session** is read-only. Every write (session start, `projects.write`, `buttons.write`, adding a link) asks; nothing is allowed directly.
- **spawned-session** may not write at all (deny). Sessions are "one level deep": a session started by a session cannot start more.
- **plugin** gets only rights its manifest requested and you granted; anything else is denied. A session start with a free prompt asks (needs `sessions.start`); a button start with simple input is allowed with `sessions.start.button`. `buttons.write` asks even when granted.
- **buttons.write** from anyone but the user always asks (or is denied, see above). The approval shows a diff of the button prompts, because a button prompt later runs without a second look.
- **projects.delete** and **closing another session** are user (and cli) only; everyone else is denied. Any session may close itself.
- **Rate limit**: at most 5 automatically allowed session starts per rolling hour across all non-user callers. Beyond that, an `allow` becomes `ask` with the reason.
- **Prompt-skipping modes** (`auto`, `bypassPermissions`): a session only runs in one if the button explicitly sets it. A button that sets such a mode and is also `lockDefaultMode` is inconsistent and every start through it is denied. A request that names both a button and a prompt, or an unknown button, is denied too.

Every write through shub is written to the activity log (Settings > Activity) with who did it. Adding or editing a project can be undone there by you.

## Honest scope

These rules only cover requests that go **through shub**. A Claude session runs in a shell as your user. From there it can run `claude -p "..."`, `tmux new`, `tmux send-keys` into another session, read `<stateDir>/token` and call shub as `cli`, or simply edit files, without shub ever seeing a request. What stands in the way of that is Claude Code's own permission prompts, nothing else. The per-session settings deny Claude's Read tool on the token, the database and the VAPID key, and its Edit and Write tools on all of `<stateDir>`; that only stops Claude's own file tools, not a shell command such as `cat <stateDir>/token`.

So shub makes actions visible and stops mistakes; it is **not a wall** between sessions. In practice:

- Keep sessions that read untrusted input (reviews of other people's merge requests, unknown repositories, web content) out of prompt-skipping modes. Mark their buttons with `lockDefaultMode`.
- Read the full prompt on an approval card before you start it. shub cannot tell where a prompt came from.
- Install plugins only from code you have read. A plugin is a process with your user's rights; its shub token limits only what it can do through shub.

## Docker

The services panel talks to `/var/run/docker.sock`, which is root-equivalent. Reading containers, logs and inspect data needs the `read` right; start, stop and restart are user (and cli) only and are logged. Inspect masks values of keys containing PASSWORD, SECRET, TOKEN, KEY or CREDENTIAL and passwords inside URLs; logs are shown as they are, so secrets an app prints will be visible.

## Reporting

Found a hole? Open a private security advisory on the GitHub repository instead of a public issue.
