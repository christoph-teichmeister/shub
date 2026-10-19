# ProjectRow

A project in the sidebar: icon, name, status badge. On hover / keyboard focus the badge gives way to "+ new session" and "settings". Draggable for reordering when `ondragstart` is set.

| Prop           | Type                     | Notes                           |
| -------------- | ------------------------ | ------------------------------- |
| `project`      | `ProjectView`            |                                 |
| `sessions`     | `Session[]`              | Drives the badge                |
| `href`         | `string`                 | Opens the project               |
| `settingsHref` | `string`                 |                                 |
| `selected`     | `boolean`                |                                 |
| `onnewsession` | `() => void`             |                                 |
| `ondragstart`  | `(e: DragEvent) => void` | Enables dragging                |
| `ondrop`       | `(e: DragEvent) => void` | Dropping another project here   |
| `children`     | snippet                  | `SessionRow`s under the project |

States: idle, selected, needs-you badge, working badge, hover (buttons), drag-over.
