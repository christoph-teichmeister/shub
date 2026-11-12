# SplitView

Up to four sessions side by side (1, 2, 3 with the first spanning two rows, or 2 x 2); with `limit` and `columns` any number in a fixed grid (the overview). A pane that needs the user gets an orange frame; the selected pane a 2px primary frame with a glow (the orange frame wins). Headers show a project chip and an accent strip.

| Prop          | Type                           | Notes                                                                                                                                          |
| ------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `sessions`    | `Session[]`                    | First `limit` are shown                                                                                                                        |
| `limit`       | `number`                       | Default 4                                                                                                                                      |
| `columns`     | `number`                       | Fixed column count, rows follow                                                                                                                |
| `onminimize`  | `(id) => void`                 | Adds a minimize button (`−`) to each header                                                                                                    |
| `projectOf`   | `(session) => {name, accent?}` | Project chip and accent strip in the header                                                                                                    |
| `maximizable` | `boolean`                      | Maximize button + double-click on title; fills the grid, click restores (Esc goes to the terminal; other panes unmount, sessions keep running) |
| `hrefFor`     | `(s) => string`                | Adds an Open link to each header                                                                                                               |
| `selectedId`  | `string \| null`               |                                                                                                                                                |
| `onselect`    | `(id) => void`                 | Header click or focus in pane                                                                                                                  |
| `actions`     | snippet `(session)`            | Optional header content (Allow/Deny)                                                                                                           |
| `pane`        | snippet `(session)`            | Body, e.g. compact TerminalView                                                                                                                |

States: 1, 2, 3, 4 panes; needs-you pane; selected pane.
