# Drawer

Panel sliding over the right side, e.g. the global Claude. A modal `<dialog>` like Dialog: focus moves in and Tab stays there, the page behind is inert (what runs there keeps running). Escape, the close button and a click on the dimmed backdrop call `onclose`; the dialog closes once the panel has slid out.

| Prop         | Type         | Default   | Notes                         |
| ------------ | ------------ | --------- | ----------------------------- |
| `open`       | `boolean`    |           |                               |
| `title`      | `string`     |           | Labels the dialog             |
| `subtitle`   | `string`     |           | Muted line under the title    |
| `closeLabel` | `string`     | `'Close'` | e.g. "Close drawer (Alt G)"   |
| `onclose`    | `() => void` |           |                               |
| `icon`       | snippet      |           | Tile before the title         |
| `actions`    | snippet      |           | Buttons before the close icon |
| `footer`     | snippet      |           | Muted note at the bottom      |
| `children`   | snippet      |           | Body, fills the height        |

Slides in from the right and back out (`--duration-base`, none under reduced motion).

States: closed, open with actions and footer.
