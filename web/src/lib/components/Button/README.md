# Button

A real `<button>` with text and an optional leading icon. Passes every other attribute through.

| Prop       | Type                                                          | Default       |
| ---------- | ------------------------------------------------------------- | ------------- |
| `variant`  | `'primary' \| 'secondary' \| 'ghost' \| 'dashed' \| 'danger'` | `'secondary'` |
| `size`     | `'sm' \| 'md'`                                                | `'md'`        |
| `icon`     | `IconName`                                                    |               |
| `pressed`  | `boolean`                                                     | (no toggle)   |
| `children` | snippet                                                       |               |

States: each variant, hover, focus-visible ring, disabled, pressed (toggles like "Split view"). One primary button per area. Dashed = a project button that is not set up yet.
