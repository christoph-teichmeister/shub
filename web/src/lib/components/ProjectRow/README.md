# ProjectRow

A project in the sidebar: icon, name, status badge. Right-click opens the project menu (`onmenu`). On hover / keyboard focus the badge gives way to "open remote" (when `project.remoteUrl` is set, new tab), "+ new session" and "settings". Draggable for reordering when `ondragstart` is set. With sessions under it, hover swaps the icon for a fold chevron that hides the session rows (remembered per project in `localStorage`, `shub.collapsed.project.<id>`); the badge still tells what the folded sessions do.

| Prop           | Type                      | Notes                                               |
| -------------- | ------------------------- | --------------------------------------------------- |
| `project`      | `ProjectView`             |                                                     |
| `sessions`     | `Session[]`               | Drives the badge                                    |
| `href`         | `string`                  | Opens the project                                   |
| `settingsHref` | `string`                  |                                                     |
| `selected`     | `boolean`                 |                                                     |
| `onnewsession` | `() => void`              |                                                     |
| `ondragstart`  | `(e: DragEvent) => void`  | Enables dragging                                    |
| `ondrop`       | `(e: DragEvent) => void`  | Dropping another project here                       |
| `onmenu`       | `(e: MouseEvent) => void` | Right-click: project menu                           |
| `countdown`    | `string`                  | Active group grace, e.g. "9:41"; replaces the badge |
| `children`     | snippet                   | `SessionRow`s under the project                     |

States: idle, folded, selected, needs-you badge, working badge, hover (buttons), drag-over, missing (`project.missing`: the folder is not on this machine; dimmed, path as tooltip, no "+ new session").
