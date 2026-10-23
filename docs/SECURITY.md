# Security

shub controls Claude Code sessions, which can run shell commands as you. This page says what shub
protects against, the exact rules it enforces, and, just as important, what it does not protect against.

## Threat model

| Threat                                                                                                                       | Covered by                                                                                                       |
| ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Someone on your network or the internet reaching shub                                                                        | Loopback-only bind, Tailscale for the phone                                                                      |
| A web page in your browser talking to shub (CSRF, DNS rebinding)                                                             | Host and Origin allow-lists                                                                                      |
| A Claude session (e.g. reviewing someone else's code) being talked into starting more sessions, changing buttons or projects | Permission rules, approvals, activity log                                                                        |
| A runaway session or plugin starting sessions in a loop                                                                      | Rate limit, "one level deep"                                                                                     |
| A plugin doing more than you agreed to                                                                                       | Per-plugin token with only the rights you granted                                                                |
| Secrets showing up in the Docker panel                                                                                       | Env values with secret-looking keys and URL passwords are masked                                                 |
| A tampered or fake update                                                                                                    | Signed `SHA256SUMS`, downloads only from the GitHub releases                                                     |
| A lost phone, or code in the phone app that should not be there                                                              | Non-extractable device key in every browser, five-minute tokens, levels, approval on the machine, instant revoke |

Not covered: anything a process does with your Unix user's rights outside shub. See [Honest scope](#honest-scope).

## Network and authentication

- shub listens on `127.0.0.1` only. The phone reaches it through `tailscale serve`; never put shub on `0.0.0.0` or behind a public proxy.
- Every request needs the `Host` to be loopback on shub's port or the host of `SHUB_PUBLIC_URL`. A foreign `Origin` is refused.
- **Access token** in `<stateDir>/token` (mode 0600). The first browser on a host sends it once to join (see below); as a Bearer token it identifies the `cli` caller. There is no cookie login. Rotate it in Settings.
- **First browser on a host**: opened on `127.0.0.1`/`localhost`, a browser creates its key and sends the public half with the access token (`POST /api/auth/bootstrap`); the server accepts it only for a loopback Host and approves it at once, because reading the token file proves you are on the machine. This device has kind `desktop`. Browsers from before key sign-in (cookie, no key) are dropped on start and join this way once.
- **Pairing** (every later browser and every phone): single-use code (8 characters without look-alikes, about 40 bits), shown as QR and as text, valid five minutes; after 20 wrong codes pairing locks until you make a new one. The device creates an ECDSA P-256 key pair in the browser whose private half cannot be read out (Web Crypto, non-extractable, kept in IndexedDB); shub stores only the public half. The device stays **pending** until you approve it in shub on this machine (or `shub device approve`). A browser loses its key when its site data is cleared: it pairs again, and the dead entry is removed in Settings > Devices.
- **Sign-in**: the device signs a single-use challenge (valid one minute) and gets a token valid five minutes, held only in the app's memory and renewed the same way. Requests send it as `Authorization: Bearer`, WebSockets as the subprotocol `bearer.<token>`. Nothing on the phone outlives five minutes if copied; the key itself cannot be copied, so code running in the app could only misuse it while the app is open.
- **One app, several machines**: a phone app installed from one machine can pair further machines. It then calls them cross-origin with that machine's token (never a cookie). Each machine answers CORS only for the app origins of phones paired with it (`devices.app_origin`); only the pairing redeem accepts any origin, because it needs the code anyway. The app's pages allow `connect-src https:` for that reason.
- **Push to a phone app with several machines**: the app owns one VAPID key pair and hands both halves to each machine with its subscription. That private key only lets a machine send pushes to this one phone.
- **Client tokens**: every Claude session and every plugin process gets its own Bearer token (`SHUB_TOKEN`), revoked when it ends. The token decides the caller kind; only the hashes are stored.

- **Host-to-host sync**: every host has its own ECDSA P-256 key (private half in `shub.db`, never synced) and is a host item of the device group together with its tailnet URL. A host signs in to another by signing a single-use challenge (valid one minute) and gets a token valid five minutes, held in memory; the other host checks the key against its own copy of the group, on sign-in and again on every call, so a revoked host is out at once, and a revoked host never re-announces itself. Trust is per group: any host that signed in may push any item, device items included, so one stolen host key can add or revoke hosts; revoke it from another host at once. The sync routes need no login and answer only to such a token. Categories switched off in Settings > Sync are neither sent nor accepted, and plugin `env` stays home unless switched on. The dialing host trusts the URL the group lists; it does not check the other end's identity, so keep it on the tailnet.

## Caller kinds

| Kind              | Who                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------ |
| `user`            | You in a browser or on a paired phone (signed-in device token, limited by its level) |
| `cli`             | The access token, i.e. you in a terminal running `shub`                              |
| `global-claude`   | The global Claude session                                                            |
| `session`         | A normal project session                                                             |
| `spawned-session` | A session started by another session                                                 |
| `plugin`          | A plugin process                                                                     |

## Device levels

Every paired device has a level. One gate in the server (`server/auth/levels.ts`, table `ROUTE_LEVELS` in `shared/api.ts`) checks it for every route; WebSockets follow it too.

| Level   | May                                                                                                                                                                                                                      |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| View    | read everything, get push                                                                                                                                                                                                |
| Prompts | View, plus decide approvals, answer permission questions (named keys such as Enter and Escape, single digits) and run commands Claude handed over (Run chips: the phone sends the index of a stored command, never text) |
| Control | everything you can do in the browser, including typing in terminals and starting sessions                                                                                                                                |

- A new phone gets **Prompts** once approved, a browser **Control**. Terminals open read-only below Control: keystrokes are dropped, resizes still apply.
- Approving a phone and changing any level work only in shub on the machine itself: the host's own browser (kind `desktop`, opened on `127.0.0.1`/`localhost`), or the `shub` CLI. A paired browser or phone never approves or raises itself or another device.
- Removing a phone, or changing its level, closes its open WebSockets at once; removing it also ends its token.
- Devices paired before this scheme (device cookie, no key) are dropped on start.

## Rules

The rules live in `server/permissions/rules.ts` as one pure `decide()` function with tests next to it.
Every decision is `allow`, `ask` (an approval card on the desktop and a push on the phone; the action waits up to 30 minutes, then counts as rejected) or `deny`.

- **user** may do everything. Only `user` can decide approvals, not even `cli`: the token file is readable by any process of your user, a device key is not.
- **cli** is like the user, except that it cannot decide approvals, its `buttons.write` asks and its session starts count towards the rate limit.
- **global-claude** may write projects and start sessions. A start through a configured button with simple input is allowed; a free prompt (or a button with non-simple input) asks.
- **session** is read-only. Every write (session start, `projects.write`, `buttons.write`, a link on another session) asks; the one direct write is a link on its own tab (`shub session link`, e.g. its MR).
- **spawned-session** may not write at all (deny). Sessions are "one level deep": a session started by a session cannot start more.
- **plugin** gets only rights its manifest requested and you granted; anything else is denied. A session start with a free prompt asks (needs `sessions.start`); a button start with simple input is allowed with `sessions.start.button`. `buttons.write` asks even when granted.
- **buttons.write** from anyone but the user always asks (or is denied, see above). The approval shows a diff of the button prompts, because a button prompt later runs without a second look.
- **projects.delete** and **closing another session** are user (and cli) only; everyone else is denied. Any session may close itself.
- **Rate limit**: at most 5 automatically allowed session starts per rolling hour across all non-user callers. Beyond that, an `allow` becomes `ask` with the reason.
- **Prompt-skipping modes** (`auto`, `bypassPermissions`): a session only runs in one if its button sets it, or if you started it (or it is the global Claude) and Settings → "Permission mode for new sessions" picks one (or `inherit`, which passes no flag so your own Claude default applies). Sessions started by sessions or plugins get `default` unless their button says otherwise; `lockDefaultMode` always means `default`. A button that sets such a mode and is also `lockDefaultMode` is inconsistent and every start through it is denied. A request that names both a button and a prompt, or an unknown button, is denied too.

Every write through shub is written to the activity log (Settings > Activity) with who did it. Adding or editing a project can be undone there by you.

## Honest scope

These rules only cover requests that go **through shub**. A Claude session runs in a shell as your user. From there it can run `claude -p "..."`, `tmux new`, `tmux send-keys` into another session, read `<stateDir>/token` and call shub as `cli`, or simply edit files, without shub ever seeing a request. What stands in the way of that is Claude Code's own permission prompts, nothing else. The per-session settings deny Claude's Read tool on the token, the database and the VAPID key, and its Edit and Write tools on all of `<stateDir>`; that only stops Claude's own file tools, not a shell command such as `cat <stateDir>/token`.

The same goes for phones: a session that reads the token file can call `shub device approve` or raise a phone's level as `cli`. Approval on the machine stops a stranger with a pairing code, not a process already running as you.

So shub makes actions visible and stops mistakes; it is **not a wall** between sessions. In practice:

- Keep sessions that read untrusted input (reviews of other people's merge requests, unknown repositories, web content) out of prompt-skipping modes. Mark their buttons with `lockDefaultMode`.
- Read the full prompt on an approval card before you start it. shub cannot tell where a prompt came from.
- Install plugins only from code you have read. A plugin is a process with your user's rights; its shub token limits only what it can do through shub.

## Updates

The launcher installs only what the release key signed: each GitHub release carries `SHA256SUMS` and an ed25519
signature of it (`SHA256SUMS.sig`), and an archive is unpacked only if its SHA-256 is listed in a SUMS file with a valid
signature from a key in `launcher/release-keys.pem` (shipped with the launcher and inside every release). Downloads
come only from `https://github.com/christoph-teichmeister/shub/releases`. Installing, rolling back and switching the
channel from the web app are for the browser `user` only (not `cli`): the token file is readable by every process of
your user, a device key is not. Key handling: [RELEASING.md](RELEASING.md).

### Phone apps and the web bundle

A phone app runs from the web bundle its loader (the service worker, which only ever comes from the machine the app
was installed from) keeps on the phone. It takes a newer bundle from any paired machine, but only if that machine's
release `SHA256SUMS` carries a valid signature from a key in the build's `release-keys.js` and lists the bundle
manifest, and every file matches its SHA-256 there. The install machine's own bundle is trusted as is (its dev builds
have no signature). A tampered machine can therefore at most keep the app on an older genuine version, not run code of
its own in it.

## Docker

The services panel talks to `/var/run/docker.sock`, which is root-equivalent. Reading containers, logs and inspect data needs the `read` right; start, stop and restart are user (and cli) only and are logged. Inspect masks values of keys containing PASSWORD, SECRET, TOKEN, KEY or CREDENTIAL and passwords inside URLs; logs are shown as they are, so secrets an app prints will be visible.

## Reporting

Found a hole? Open a private security advisory on the GitHub repository instead of a public issue.
