# SelectField

Labelled native `<select>`. Other select attributes pass through.

| Prop        | Type                                 | Default | Notes                                   |
| ----------- | ------------------------------------ | ------- | --------------------------------------- |
| `label`     | `string`                             |         | `hideLabel` keeps it for screen readers |
| `value`     | `string`                             |         | Bindable                                |
| `options`   | `{ value: string; label: string }[]` |         |                                         |
| `hint`      | `string`                             |         |                                         |
| `hideLabel` | `boolean`                            | `false` | For selects inside table rows           |
| `size`      | `'sm' \| 'md'`                       | `'md'`  | `sm` inside tables                      |

States: default, small in a table row, with hint, disabled.
