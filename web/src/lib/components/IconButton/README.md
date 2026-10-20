# IconButton

Square button (or link with `href`) showing only an icon. `label` is required: it becomes `aria-label` and the tooltip.

| Prop       | Type                                                    | Default     |
| ---------- | ------------------------------------------------------- | ----------- |
| `label`    | `string`                                                |             |
| `icon`     | `IconName`                                              |             |
| `size`     | `'xs' \| 'sm' \| 'md' \| 'lg'`                          | `'sm'`      |
| `variant`  | `'ghost' \| 'outline' \| 'filled'`                      | `'ghost'`   |
| `tone`     | `'default' \| 'muted' \| 'start' \| 'stop' \| 'accent'` | `'default'` |
| `pressed`  | `boolean`                                               |             |
| `disabled` | `boolean`                                               | `false`     |
| `href`     | `string`                                                |             |
| `external` | `boolean` (opens `href` in a new tab)                   | `false`     |
| `onclick`  | `(e) => void`                                           |             |

States: each variant and tone, hover, pressed, disabled, focus ring.
