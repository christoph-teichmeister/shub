# Plugins

A shub plugin is any program in any language that talks to shub over HTTP. shub starts it as its
own process with its own token; the plugin can only do what its manifest requested and you granted.
`examples/plugin-hello/` is a complete Python plugin using only the standard library.

## Install and manage

```sh
shub plugin add <git-url>                 # clone, validate, install disabled with no rights
shub plugin list
shub plugin enable <name> --grant read,ui.contribute
shub plugin remove <name>                 # asks first, stops it, deletes its folder
```

Plugins live in `~/.config/shub/plugins/<name>/` (`$SHUB_CONFIG_DIR/plugins`). Enabled state and granted
rights are in `config.json` under `plugins`; change them in Settings > Plugins, with `shub plugin enable`
or `PATCH /api/plugins/:name` `{ "enabled": true, "grantedRights": ["read"] }` (you only).

## Manifest: `shub-plugin.json`

```json
{
  "name": "hello",
  "version": "0.1.0",
  "description": "Shows how many sessions are running.",
  "start": ["python3", "-u", "plugin.py"],
  "rights": ["read", "ui.contribute"],
  "contributes": {
    "sidebarSections": [{ "id": "hello", "title": "Hello" }],
    "sessionMenuActions": [{ "id": "open-card", "label": "Open card" }],
    "settingsActions": [{ "id": "say-hello", "label": "Say hello" }]
  }
}
```

| Field         | Rules                                                                                                                              |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `name`        | `^[a-z0-9-]+$`, at most 64 chars, equal to the folder name                                                                         |
| `version`     | non-empty string                                                                                                                   |
| `description` | optional, at most 500 chars                                                                                                        |
| `start`       | non-empty array of non-empty strings; run in the plugin folder **without a shell**                                                 |
| `rights`      | subset of the rights below, no duplicates                                                                                          |
| `contributes` | optional; each list item is `{ id, title }` (sections) or `{ id, label }` (actions), ids `^[a-zA-Z0-9_.-]{1,64}$`, unique per list |

Unknown keys are an error. A folder with an invalid manifest is skipped (the server logs why).

## Rights

| Right                   | Allows                                                                       |
| ----------------------- | ---------------------------------------------------------------------------- |
| `read`                  | GET sessions, projects, services, activity, events                           |
| `projects.write`        | change projects                                                              |
| `sessions.start`        | start sessions with a free prompt; **always asks you**                       |
| `sessions.start.button` | start sessions through a configured button with simple input, without asking |
| `sessions.link`         | add links to sessions (e.g. a board card)                                    |
| `buttons.write`         | propose button changes; **always asks you** with a prompt diff               |
| `ui.contribute`         | fill the plugin's own sidebar sections                                       |

Automatic starts share a budget of 5 per hour with all other non-user callers. Full rules: [SECURITY.md](SECURITY.md).

## Lifecycle

- shub starts every enabled plugin at startup and when you enable it, and stops it when you disable it, remove it or shub shuts down (SIGTERM, SIGKILL after 5 s).
- If it exits, shub restarts it with backoff: 1 s, doubling up to 60 s; a run longer than 60 s resets the backoff.
- The last 500 lines of stdout and stderr are kept in memory: Settings > Plugins > Logs, or `GET /api/plugins/:name/logs`.
- Granting or revoking rights takes effect on the next request, without a restart.

## Environment

| Variable           | Value                                                    |
| ------------------ | -------------------------------------------------------- |
| `SHUB_URL`         | e.g. `http://127.0.0.1:4780`                             |
| `SHUB_TOKEN`       | Bearer token for this process run, revoked when it exits |
| `SHUB_PLUGIN_NAME` | the manifest name                                        |

The rest of shub's environment is inherited.

## API usage

Send `Authorization: Bearer $SHUB_TOKEN` and JSON. All routes are in `shared/api.ts` (`ROUTES`) and [API.md](API.md).
Errors are `{ "error": "..." }` with 400/403/404; a session start that needs your OK returns `{ "approval": ... }`.

**Sidebar sections.** `PUT /api/plugins/:name/sections/:sectionId` with a `SidebarSectionContent`:

```json
{
  "badge": { "text": "2 need you", "tone": "needs-you" },
  "entries": [
    {
      "id": "198",
      "title": "Clean up the dotfiles repo",
      "subtitle": "po-review",
      "tone": "needs-you",
      "url": "https://kb.example/card/198",
      "action": "open-card"
    }
  ]
}
```

Only declared section ids of your own plugin; needs `ui.contribute`. At most 50 entries (more are cut),
strings at most 200 chars (cut), `url` only `http`/`https`, tones `needs-you | working | done | neutral`
(badge: `needs-you | working | neutral`). Content is kept in memory and cleared when the plugin is stopped,
so push it again after start.

**Actions.** When you click a declared session-menu or settings action, shub emits
`{ "type": "plugin.action", "plugin": "<name>", "actionId": "...", "context": { "sessionId"?, "projectId"? } }`.

## Events

- `GET /api/events/stream`: Server-Sent Events, one `data: <ServerEvent JSON>` per event; easiest from any language.
- `/api/events`: the same `ServerEvent` stream as a WebSocket.

The first event is `{ "type": "hello", "apiVersion": 1 }`. Filter `plugin.action` events by your `plugin` name.
Reconnect when the stream ends (shub restarts, or your process is restarted anyway).

## Security note

The token limits what a plugin can do **through shub**. The plugin itself is a normal process with your
user's rights: it can read your files and run commands. Only install plugins whose code you have read,
the same way you would treat any script you run. See [SECURITY.md](SECURITY.md#honest-scope).
