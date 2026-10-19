# Icon

Inline stroke SVG on a 16 px grid, drawn in `currentColor`. Paths live in `icons.ts`.

| Prop     | Type                           | Default | Notes                                        |
| -------- | ------------------------------ | ------- | -------------------------------------------- |
| `name`   | `IconName`                     |         | Key of `ICONS`                               |
| `size`   | `'xs' \| 'sm' \| 'md' \| 'lg'` | `'lg'`  | 10 / 12 / 14 / 16 px from tokens             |
| `weight` | `number`                       | `1.6`   | Stroke width                                 |
| `label`  | `string`                       |         | Gives the icon a name; otherwise aria-hidden |

States: stroke icons, filled icons (`play`, `stop`). Add an icon by adding a path to `icons.ts`.
