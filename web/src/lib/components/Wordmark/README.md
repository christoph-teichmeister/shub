# Wordmark

`shub_` in JetBrains Mono. The underscore carries the open project's accent; when any session needs the user it turns orange and blinks once per second (colour only with `prefers-reduced-motion`).

| Prop       | Type                           | Default | Notes                              |
| ---------- | ------------------------------ | ------- | ---------------------------------- |
| `size`     | `'sm' \| 'md' \| 'lg' \| 'xl'` | `'md'`  | 13 / 17 / 28 / 56 px; md = sidebar |
| `accent`   | CSS colour                     | pink    | Project accent, never orange       |
| `needsYou` | `boolean`                      | `false` |                                    |
| `tagline`  | `boolean`                      | `false` | Adds "your session hub" below      |

States: default, project accent, needs you (blinking), with tagline.
