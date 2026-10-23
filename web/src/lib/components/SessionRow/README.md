# SessionRow

One session under its project in the sidebar: status mark, name, status text, a link to `#/p/<project>/<session>`. With `onmenu`, hover or focus swaps the status text for a menu button (`⋯`), and right-click opens the same session menu.

| Prop          | Type                       | Default                                                |
| ------------- | -------------------------- | ------------------------------------------------------ |
| `session`     | `Session`                  |                                                        |
| `href`        | `string`                   |                                                        |
| `selected`    | `boolean`                  | `false`                                                |
| `closing`     | `boolean`                  | `false`                                                |
| `onmenu`      | `(at: {x, y}) => void`     |                                                        |
| `ondragstart` | `(e: DragEvent) => void`   | Makes the row draggable                                |
| `ondrop`      | `(after: boolean) => void` | `after`: dropped on the lower half                     |
| `onunpin`     | `() => void`               | Pin button on a dragged session                        |
| `onrename`    | `(name: string) => void`   | Double-click renames in place; only called on a change |

States: pinned (dragged, `position` set: a pin button that unpins it), drop target (line above or below), commands waiting (status reads `▶ N command(s)`, hover shows them), closing (fades out, status reads `Closing`, inert), needs-you (tinted orange row), working, your-turn, waiting (tooltip: what for and the last background check), paused, exited, selected.

Context fill: a 2px bar along the bottom edge (width = share of the window; colour by tokens: muted, yellow from 120k, danger from 160k), the numbers in the row's tooltip.
