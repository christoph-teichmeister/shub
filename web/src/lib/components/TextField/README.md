# TextField

Labelled text input (or textarea with `rows`). Other input attributes (`type`, `required`, `list`, `autocomplete`, `placeholder`, ...) pass through.

| Prop        | Type               | Default | Notes                                     |
| ----------- | ------------------ | ------- | ----------------------------------------- |
| `label`     | `string`           |         | Always rendered; `hideLabel` hides it     |
| `value`     | `string \| number` |         | Bindable                                  |
| `hint`      | `string`           |         | Muted line under the field                |
| `error`     | `string`           |         | Replaces the hint, sets `aria-invalid`    |
| `mono`      | `boolean`          | `false` | JetBrains Mono for paths, tokens, colours |
| `hideLabel` | `boolean`          | `false` | Label for screen readers only             |
| `rows`      | `number`           |         | Textarea                                  |

States: empty, filled, with hint, with error, mono, textarea, disabled.
