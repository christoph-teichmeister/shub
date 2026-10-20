# ProjectIcon

Square tile for a project: the GitHub mark or GitLab tanuki (Simple Icons, CC0, in `logos.ts`; auto-detected from the git remote), a symbol icon on the project colour, an image, or the first letter.

| Prop   | Type                   | Default | Notes                                  |
| ------ | ---------------------- | ------- | -------------------------------------- |
| `icon` | `ResolvedIcon`         |         | From `ProjectView.resolvedIcon`        |
| `name` | `string`               |         | Fallback letter                        |
| `size` | `'sm' \| 'md' \| 'lg'` | `'md'`  | 16 / 22 / 32 px; lg is the header icon |

States: `github`, `gitlab`, `symbol` (any `IconName`, e.g. `table`, `home`, `book`), `image`, `none`. An image that fails to load shows `?` with a tooltip naming the URL and the fix. The symbol colour comes from project data (never orange).
