# Drawer

Panel sliding over the right side (`<aside>`), e.g. the global Claude. Not modal: what runs behind keeps running. Escape (inside the drawer), the close button and a click on the dimmed backdrop call `onclose`.

| Prop         | Type         | Default   | Notes                         |
| ------------ | ------------ | --------- | ----------------------------- |
| `open`       | `boolean`    |           |                               |
| `title`      | `string`     |           | Labels the aside              |
| `subtitle`   | `string`     |           | Muted line under the title    |
| `closeLabel` | `string`     | `'Close'` | e.g. "Close drawer (Alt G)"   |
| `onclose`    | `() => void` |           |                               |
| `icon`       | snippet      |           | Tile before the title         |
| `actions`    | snippet      |           | Buttons before the close icon |
| `footer`     | snippet      |           | Muted note at the bottom      |
| `children`   | snippet      |           | Body, fills the height        |

States: closed, open with actions and footer.
