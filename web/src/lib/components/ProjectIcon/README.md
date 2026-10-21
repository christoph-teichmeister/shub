# ProjectIcon

Square tile for a project: its own image, a symbol icon on the project colour, or else up to two letters of the name ("ai-portal" → AP) on one of the 10 `PROJECT_COLORS` picked from the name, so it is the same everywhere. Auto-detected GitHub/GitLab projects get letters too: one logo for every project told them apart from nothing.

| Prop   | Type                   | Default | Notes                                  |
| ------ | ---------------------- | ------- | -------------------------------------- |
| `icon` | `ResolvedIcon`         |         | From `ProjectView.resolvedIcon`        |
| `name` | `string`               |         | Fallback letters and their colour      |
| `size` | `'sm' \| 'md' \| 'lg'` | `'md'`  | 16 / 22 / 32 px; lg is the header icon |

States: `symbol` (any `IconName`, e.g. `table`, `home`, `book`), `image`; `github`, `gitlab` and `none` all show letters. An image that fails to load shows `?` with a tooltip naming the URL and the fix. The symbol colour comes from project data (never orange).
