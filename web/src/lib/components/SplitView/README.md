# SplitView

Up to four sessions side by side (1, 2, 3 with the first spanning two rows, or 2 x 2). A pane that needs the user gets an orange frame; the selected pane a primary frame.

| Prop         | Type                | Notes                           |
| ------------ | ------------------- | ------------------------------- |
| `sessions`   | `Session[]`         | First four are shown            |
| `selectedId` | `string \| null`    |                                 |
| `onselect`   | `(id) => void`      | Header click or focus in pane   |
| `pane`       | snippet `(session)` | Body, e.g. compact TerminalView |

States: 1, 2, 3, 4 panes; needs-you pane; selected pane.
