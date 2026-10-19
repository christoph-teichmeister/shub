# BottomPanel

The panel under the terminal: tabs "Services", "Terminal 1..n" and "+" for a new plain terminal, a hide button. The view renders the active tab's content as `children`. Left / Right / Home / End move between the tabs.

| Prop       | Type              |
| ---------- | ----------------- |
| `tabs`     | `{ id, label }[]` |
| `active`   | `string`          |
| `onselect` | `(id) => void`    |
| `onnew`    | `() => void`      |
| `onhide`   | `() => void`      |
| `context`  | `string`          |
| `children` | snippet           |

States: services tab active, terminal tab active.
